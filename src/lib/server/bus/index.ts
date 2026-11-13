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
import { dbMode } from '$lib/server/db/client';
import { hasSeq, MemoryBus } from './memory';
import { allocateSeq, PgTransport, readOps } from './pg';
import { SYNTH_WORKSPACE, syntheticRun } from './synthetic';

export { SYNTH_WORKSPACE } from './synthetic';

type OpsReader = (workspaceId: string, after: number, limit: number) => Promise<OpEnvelope[]>;

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

const viaPg = (workspaceId: string) => workspaceId !== SYNTH_WORKSPACE && bus().pg;

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

/** Fixture mode: let the PGlite store answer op catch-up instead of the in-memory ring. */
export function setFixtureOpsReader(reader: OpsReader | null): void {
	bus().fixtureReader = reader;
}

async function readOpEnvelopes(workspaceId: string, after: number, limit: number) {
	const b = bus();
	if (viaPg(workspaceId)) return readOps(workspaceId, after, limit);
	if (b.fixtureReader && workspaceId !== SYNTH_WORKSPACE)
		return b.fixtureReader(workspaceId, after, limit);
	return b.local
		.after(workspaceId, after)
		.flatMap((e) => (e.kind === 'op' ? [e.envelope] : []))
		.slice(0, limit);
}

/** Everything a client missed after `after`: durable ops merged with ring-only sim events, by seq. */
export async function catchUp(
	workspaceId: string,
	after: number,
	limit = 1000
): Promise<ServerEvent[]> {
	const ops = await readOpEnvelopes(workspaceId, after, limit);
	const opEvents: ServerEvent[] = ops.map((envelope) => ({
		kind: 'op',
		seq: envelope.seq,
		envelope
	}));
	const sims = bus()
		.local.after(workspaceId, after)
		.filter((e) => e.kind === 'sim');
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
