/**
 * The event bus behind the `Ops` port (core/ports.ts) and /api/events.
 * - Fixture mode (no DATABASE_URL): in-process MemoryBus only.
 * - Postgres mode: publish goes through NOTIFY and every process delivers from its LISTEN connection.
 * The simulated run and the dev load test stay in memory and never touch the database.
 *
 * The Store calls `publish(workspaceId, events)` after each transaction commits.
 */
import type { OpEnvelope, ServerEvent } from '$lib/core/contracts';
import type { Ops } from '$lib/core/ports';
import { and, asc, eq, gt } from 'drizzle-orm';
import { dbMode } from '$lib/server/db/client';
import * as schema from '$lib/server/db/schema';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { errMsg, log } from '$lib/server/obs/log';
import { hasSeq, MemoryBus } from './memory';
import { PgTransport, readOps } from './pg';
import { simDone, simTraces, SYNTH_WORKSPACE, syntheticRun } from './synthetic';
import { STRESS_WORKSPACE, stressEvents } from './stress';

export { SYNTH_WORKSPACE } from './synthetic';
export { STRESS_WORKSPACE } from './stress';

type OpsReader = (
	workspaceId: string,
	after: number,
	limit: number,
	runId?: string
) => Promise<OpEnvelope[]>;

interface BusState {
	local: MemoryBus;
	pg: PgTransport | null;
	/** Where op catch-up reads from in fixture mode (tools/handlers.ts installs the PGlite reader). */
	fixtureReader: OpsReader | null;
	synth: { timer: ReturnType<typeof setTimeout> | null; run: number };
}

const g = globalThis as typeof globalThis & { __mandateBus?: BusState };

function bus(): BusState {
	if (!g.__mandateBus) {
		const local = new MemoryBus();
		g.__mandateBus = {
			local,
			pg: dbMode() === 'postgres' ? new PgTransport(local) : null,
			fixtureReader: null,
			synth: { timer: null, run: 0 }
		};
	}
	return g.__mandateBus;
}

/** The simulated run and the dev load test live in memory only: no database rows, no NOTIFY. */
export const isMemoryOnly = (workspaceId: string) =>
	workspaceId === SYNTH_WORKSPACE || workspaceId === STRESS_WORKSPACE;

const viaPg = (workspaceId: string) => !isMemoryOnly(workspaceId) && bus().pg;

/** Deliver events to every subscriber of the workspace (across processes in Postgres mode). */
export async function publish(workspaceId: string, events: ServerEvent[]): Promise<void> {
	if (!events.length) return;
	if (!isMemoryOnly(workspaceId)) {
		logOps(workspaceId, events);
		warmPlanPhotos(workspaceId, events);
	}
	const pg = viaPg(workspaceId);
	if (pg) await pg.publish(workspaceId, events);
	else bus().local.deliver(workspaceId, events);
}

/**
 * A plan created or re-priced: warm its products' photos in the background (live web mode only, the workspace's web
 * prefetch cap, products/photos PREFETCH_LIMITS), so the rows show them when they render. Fire and forget; never delays or fails the write.
 */
function warmPlanPhotos(workspaceId: string, events: ServerEvent[]) {
	if (process.env.VITEST) return;
	const ids = new Set<string>();
	for (const e of events) {
		if (e.kind !== 'op') continue;
		const op = e.envelope.op;
		if (op.type === 'CreatePlan') for (const l of op.plan.lines) ids.add(l.productId);
		else if (op.type === 'RecordOffer') for (const l of op.lines) ids.add(l.productId);
	}
	if (!ids.size) return;
	void (async () => {
		const { webMode } = await import('../web');
		if (webMode(process.env) !== 'live') return;
		const [{ createServerPorts }, { warmPhotos }] = await Promise.all([
			import('../store/server-ports'),
			import('../products/photos')
		]);
		const { ports } = await createServerPorts();
		const products = await ports.catalog.get([...ids]);
		await warmPhotos(process.env, `prefetch:${workspaceId}`, [...products.values()]);
	})().catch((err) => log.warn('photos.warm_failed', { workspaceId, error: errMsg(err) }));
}

/** One line per op written (type, seq) and a warning line per refusal; the simulated runs stay quiet. */
function logOps(workspaceId: string, events: ServerEvent[]) {
	for (const e of events) {
		if (e.kind !== 'op') continue;
		const { op, runId, via, actor } = e.envelope;
		const fields = {
			workspaceId,
			runId,
			type: op.type,
			seq: e.seq,
			via,
			actor: `${actor.kind}:${actor.id}`
		};
		if (op.type === 'RecordRefusal')
			log.warn('refusal', { ...fields, tool: op.tool, code: op.code, sub: op.sub });
		else log.info('op.written', fields);
	}
}

/** An OpsReader over any Drizzle db with our schema (PGlite or Postgres). */
export function drizzleOpsReader(db: AnyDb): OpsReader {
	return async (workspaceId, after, limit, runId) => {
		const rows = await db
			.select({ envelope: schema.ops.envelope })
			.from(schema.ops)
			.where(
				and(
					eq(schema.ops.workspaceId, workspaceId),
					gt(schema.ops.seq, after),
					runId ? eq(schema.ops.runId, runId) : undefined
				)
			)
			.orderBy(asc(schema.ops.seq))
			.limit(limit);
		return rows.map((r: { envelope: unknown }) => r.envelope as OpEnvelope);
	};
}

/** Fixture mode: let the PGlite store answer op catch-up instead of the in-memory ring. */
export function setFixtureOpsReader(reader: OpsReader | null): void {
	bus().fixtureReader = reader;
}

async function readOpEnvelopes(workspaceId: string, after: number, limit: number, runId?: string) {
	const b = bus();
	if (viaPg(workspaceId)) return readOps(workspaceId, after, limit, runId);
	if (b.fixtureReader && !isMemoryOnly(workspaceId))
		return b.fixtureReader(workspaceId, after, limit, runId);
	return b.local
		.after(workspaceId, after)
		.flatMap((e) => (e.kind === 'op' && (!runId || e.envelope.runId === runId) ? [e.envelope] : []))
		.slice(0, limit);
}

/** Everything a client missed after `after`: durable ops merged with ring-only sim events, by seq. */
export async function catchUp(
	workspaceId: string,
	after: number,
	limit = 1000,
	/** Only events of this run (the workspace's current run); all runs when omitted. */
	runId?: string
): Promise<ServerEvent[]> {
	const ops = await readOpEnvelopes(workspaceId, after, limit, runId);
	const opEvents: ServerEvent[] = ops.map((envelope) => ({
		kind: 'op',
		seq: envelope.seq,
		envelope
	}));
	const sims = bus()
		.local.after(workspaceId, after)
		.filter((e) => e.kind === 'sim' && (!runId || e.runId === runId));
	const seen = new Set<number>();
	return [...opEvents, ...sims]
		.filter((e) => hasSeq(e) && !seen.has(e.seq) && seen.add(e.seq))
		.sort((a, b) => (hasSeq(a) && hasSeq(b) ? a.seq - b.seq : 0))
		.slice(0, limit);
}

export function subscribe(workspaceId: string, fn: (e: ServerEvent) => void): () => void {
	if (viaPg(workspaceId)) void bus().pg!.start();
	const off = bus().local.subscribe(workspaceId, fn);
	if (workspaceId === SYNTH_WORKSPACE) startSynthetic();
	return off;
}

/** The `Ops` port. */
export function createOps(): Ops {
	return {
		readAfter: (workspaceId, seq, limit = 1000) => readOpEnvelopes(workspaceId, seq, limit),
		subscribe
	};
}

/** Milliseconds between synthetic steps, and the pause before the next run starts. */
const STEP_MS = 2400;
const LOOP_PAUSE_MS = 12_000;

/**
 * Plays the scripted run into SYNTH_WORKSPACE while anyone is watching, then loops with a new runId.
 * Stops when the last subscriber leaves.
 */
function startSynthetic(): void {
	const b = bus();
	if (b.synth.timer) return;
	const play = () => {
		b.synth.run += 1;
		const t0 = Date.now();
		const events = syntheticRun({
			runId: `synth-${b.synth.run}`,
			startSeq: b.local.highestSeq(SYNTH_WORKSPACE) + 1,
			wall: (i) => new Date(t0 + i * STEP_MS)
		});
		let i = 0;
		const steps = new Map<string, number>();
		const tick = () => {
			if (!b.local.listenerCount(SYNTH_WORKSPACE)) {
				b.synth.timer = null;
				return;
			}
			if (i < events.length) {
				const e = events[i++];
				// Agent ops come with their simulated trace: the planned step before, the tool result after.
				if (e.kind === 'op') {
					const id = e.envelope.actor.id;
					steps.set(id, (steps.get(id) ?? 0) + 1);
					const t = simTraces(e.envelope, steps.get(id)!);
					b.local.deliver(SYNTH_WORKSPACE, [...t.before, e, ...t.after]);
				} else b.local.deliver(SYNTH_WORKSPACE, [e]);
				b.synth.timer = setTimeout(tick, STEP_MS);
			} else {
				const last = events.at(-1);
				if (last && last.kind === 'op')
					b.local.deliver(SYNTH_WORKSPACE, simDone(last.envelope, new Date().toISOString()));
				b.synth.timer = setTimeout(play, LOOP_PAUSE_MS);
			}
		};
		b.synth.timer = setTimeout(tick, 400);
	};
	play();
}

/**
 * Dev-only load for the 10× check: replays `copies` interleaved synthetic runs into STRESS_WORKSPACE in
 * bursts of BURST events every BURST_MS, as fast as many busy kitchens would produce them.
 */
const BURST = 25;
const BURST_MS = 100;
export function startStress(copies: number): void {
	const b = bus();
	b.local.reset(STRESS_WORKSPACE);
	const events = stressEvents(copies, `stress-${Date.now().toString(36)}`).map((e) =>
		'seq' in e ? { ...e, seq: e.seq + b.local.highestSeq(STRESS_WORKSPACE) } : e
	);
	for (const e of events) if (e.kind === 'op') e.envelope.seq = e.seq;
	let i = 0;
	const tick = () => {
		b.local.deliver(STRESS_WORKSPACE, events.slice(i, i + BURST));
		i += BURST;
		if (i < events.length) setTimeout(tick, BURST_MS);
	};
	setTimeout(tick, 300);
}
