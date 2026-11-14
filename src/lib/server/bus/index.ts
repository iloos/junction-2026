/**
 * The event bus behind the `Ops` port (core/ports.ts) and /api/events.
 * - Fixture mode (no DATABASE_URL): in-process MemoryBus only.
 * - Postgres mode: publish goes through NOTIFY and every process delivers from its LISTEN connection.
 * The synthetic workspace always stays in memory and never touches the database.
 *
 * Contract with the Store (core-db): call `publish(workspaceId, events)` after the transaction commits.
 */
import type { OpEnvelope, Scope, ServerEvent, SimEvent } from '$lib/core/contracts';
import type { Ops } from '$lib/core/ports';
import { and, asc, eq, gt } from 'drizzle-orm';
import { dbMode } from '$lib/server/db/client';
import * as schema from '$lib/server/db/schema';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { hasSeq, MemoryBus } from './memory';
import { allocateSeq, PgTransport, readOps } from './pg';
import { SYNTH_WORKSPACE, syntheticRun } from './synthetic';
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
	/** Where op catch-up reads from in fixture mode (core-db plugs its PGlite reader in). */
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

const viaPg = (workspaceId: string) =>
	workspaceId !== SYNTH_WORKSPACE && workspaceId !== STRESS_WORKSPACE && bus().pg;

/** Deliver events to every subscriber of the workspace (across processes in Postgres mode). */
export async function publish(workspaceId: string, events: ServerEvent[]): Promise<void> {
	if (!events.length) return;
	const pg = viaPg(workspaceId);
	if (pg) await pg.publish(workspaceId, events);
	else bus().local.deliver(workspaceId, events);
}

/** Publish a simulator event, taking its seq from the workspace sequence (Postgres) or the local ring. */
export async function publishSim(scope: Scope, event: SimEvent): Promise<void> {
	const pg = viaPg(scope.workspaceId);
	const seq = pg ? await allocateSeq(scope.workspaceId) : bus().local.reserveSeq(scope.workspaceId);
	if (seq === null) throw new Error(`workspace ${scope.workspaceId} not found`);
	await publish(scope.workspaceId, [{ kind: 'sim', seq, ...scope, event }]);
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
	if (b.fixtureReader && workspaceId !== SYNTH_WORKSPACE && workspaceId !== STRESS_WORKSPACE)
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
		const tick = () => {
			if (!b.local.listenerCount(SYNTH_WORKSPACE)) {
				b.synth.timer = null;
				return;
			}
			if (i < events.length) {
				b.local.deliver(SYNTH_WORKSPACE, [events[i++]]);
				b.synth.timer = setTimeout(tick, STEP_MS);
			} else b.synth.timer = setTimeout(play, LOOP_PAUSE_MS);
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
