import type { OpEnvelope, ServerEvent } from '$lib/core/contracts';
import { sql } from '$lib/server/db/client';
import type { MemoryBus } from './memory';

/** One channel for every workspace; the payload names the workspace. */
export const CHANNEL = 'mandate_events';
/** NOTIFY payloads must stay under 8000 bytes. Ops above this are sent as a reference and fetched. */
const INLINE_LIMIT = 7000;

type Wire = { ws: string; inline: ServerEvent } | { ws: string; ref: { kind: 'op'; seq: number } };

/**
 * Postgres LISTEN/NOTIFY transport. One listener connection per process (on top of the pool's 3).
 * Every process, the publisher included, receives through the listener, so delivery is the same everywhere.
 */
export class PgTransport {
	private listening: Promise<unknown> | null = null;

	constructor(private local: MemoryBus) {}

	start(): Promise<unknown> {
		return (this.listening ??= sql()
			.listen(CHANNEL, (payload) => void this.receive(payload))
			.catch((e) => {
				this.listening = null;
				console.error('[bus] LISTEN failed', e instanceof Error ? e.message : e);
			}));
	}

	async publish(workspaceId: string, events: ServerEvent[]): Promise<void> {
		await this.start();
		for (const e of events) {
			let wire: Wire = { ws: workspaceId, inline: e };
			let text = JSON.stringify(wire);
			if (text.length > INLINE_LIMIT) {
				if (e.kind !== 'op') {
					console.warn(`[bus] dropped ${e.kind} event over ${INLINE_LIMIT} bytes`);
					continue;
				}
				wire = { ws: workspaceId, ref: { kind: 'op', seq: e.seq } };
				text = JSON.stringify(wire);
			}
			await sql().notify(CHANNEL, text);
		}
	}

	private async receive(payload: string): Promise<void> {
		try {
			const wire = JSON.parse(payload) as Wire;
			if ('inline' in wire) return this.local.deliver(wire.ws, [wire.inline]);
			const [env] = await readOps(wire.ws, wire.ref.seq - 1, 1);
			if (env?.seq === wire.ref.seq)
				this.local.deliver(wire.ws, [{ kind: 'op', seq: env.seq, envelope: env }]);
		} catch (e) {
			console.error('[bus] bad NOTIFY payload', e instanceof Error ? e.message : e);
		}
	}
}

/** Op log read straight from the `ops` table (schema.ts). */
export async function readOps(
	workspaceId: string,
	after: number,
	limit = 1000,
	/** Only this run's ops; filtered before the limit so old runs can't crowd it out. */
	runId?: string
): Promise<OpEnvelope[]> {
	const rows = runId
		? await sql()<{ envelope: OpEnvelope }[]>`
		select envelope from ops
		where workspace_id = ${workspaceId} and run_id = ${runId} and seq > ${after}
		order by seq limit ${limit}`
		: await sql()<{ envelope: OpEnvelope }[]>`
		select envelope from ops
		where workspace_id = ${workspaceId} and seq > ${after}
		order by seq limit ${limit}`;
	return rows.map((r) => r.envelope);
}

/** Allocate a seq from the workspace sequence (the same counter ops use). Null if the workspace row is missing. */
export async function allocateSeq(workspaceId: string): Promise<number | null> {
	const rows = await sql()<{ seq: number }[]>`
		update workspaces set last_seq = last_seq + 1 where id = ${workspaceId} returning last_seq as seq`;
	return rows[0] ? Number(rows[0].seq) : null;
}
