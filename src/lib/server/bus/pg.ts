import type { OpEnvelope, ServerEvent } from '$lib/core/contracts';
import { sql } from '$lib/server/db/client';
import type { MemoryBus } from './memory';
import { errMsg, log } from '$lib/server/obs/log';

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
	/**
	 * Per workspace, the delivery of the last notification. Each one waits for the one before it, so an op sent by
	 * reference (fetched from the database) is never overtaken by a later inline one: the op stream drops any seq
	 * at or below the highest it has sent, so out-of-order delivery would lose the earlier op.
	 */
	private chains = new Map<string, Promise<void>>();

	constructor(private local: MemoryBus) {}

	start(): Promise<unknown> {
		return (this.listening ??= sql()
			.listen(CHANNEL, (payload) => this.enqueue(payload))
			.catch((e) => {
				this.listening = null;
				log.error('bus.listen_failed', { error: errMsg(e) });
			}));
	}

	async publish(workspaceId: string, events: ServerEvent[]): Promise<void> {
		await this.start();
		for (const e of events) {
			let wire: Wire = { ws: workspaceId, inline: e };
			let text = JSON.stringify(wire);
			// The limit is in bytes: Finnish and other non-ASCII text takes more bytes than characters.
			if (Buffer.byteLength(text, 'utf8') > INLINE_LIMIT) {
				if (e.kind !== 'op') {
					log.warn('bus.event_dropped', { kind: e.kind, limitBytes: INLINE_LIMIT, workspaceId });
					continue;
				}
				wire = { ws: workspaceId, ref: { kind: 'op', seq: e.seq } };
				text = JSON.stringify(wire);
			}
			await sql().notify(CHANNEL, text);
		}
	}

	/** Deliver notifications per workspace in the order they arrived (see `chains`). */
	private enqueue(payload: string): void {
		let wire: Wire;
		try {
			wire = JSON.parse(payload) as Wire;
		} catch (e) {
			log.error('bus.bad_payload', { error: errMsg(e) });
			return;
		}
		const prev = this.chains.get(wire.ws) ?? Promise.resolve();
		const next = prev.then(() => this.receive(wire));
		this.chains.set(wire.ws, next);
		void next.then(() => {
			if (this.chains.get(wire.ws) === next) this.chains.delete(wire.ws);
		});
	}

	private async receive(wire: Wire): Promise<void> {
		try {
			if ('inline' in wire) return this.local.deliver(wire.ws, [wire.inline]);
			const [env] = await readOps(wire.ws, wire.ref.seq - 1, 1);
			if (env?.seq === wire.ref.seq)
				this.local.deliver(wire.ws, [{ kind: 'op', seq: env.seq, envelope: env }]);
		} catch (e) {
			log.error('bus.not_delivered', { error: errMsg(e) });
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
