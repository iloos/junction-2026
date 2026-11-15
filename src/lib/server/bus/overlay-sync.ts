/**
 * The simulated overlay (shortages, contention, incidents) shared by every app process on the database: each local
 * change goes out on its own LISTEN/NOTIFY channel, and each process applies the others' changes to its own overlay.
 * So a presenter's incident run on one machine cuts stock for stores served by another. A process that starts later
 * begins empty, as a single process does after a restart.
 */
import { randomUUID } from 'node:crypto';
import type { OverlayOp, SimOverlay } from '../adapters/simulator/overlay';
import { dbMode, sql } from '$lib/server/db/client';
import { errMsg, log } from '$lib/server/obs/log';

export const OVERLAY_CHANNEL = 'mandate_overlay';

/** The wire between processes: the sender, so a process ignores its own changes. */
export interface OverlayWire {
	origin: string;
	op: OverlayOp;
}

/** Connect an overlay to a transport (Postgres in production, an in-memory pair in tests). */
export function linkOverlay(
	overlay: SimOverlay,
	t: { send(w: OverlayWire): void; listen(fn: (w: OverlayWire) => void): void },
	origin: string = randomUUID()
): () => void {
	t.listen((w) => {
		if (w.origin !== origin) overlay.applyRemote(w.op);
	});
	return overlay.onChange((op) => t.send({ origin, op }));
}

const linked = new WeakSet<SimOverlay>();

/** In Postgres mode, share this process's overlay with every other process on the database. Idempotent. */
export function syncOverlay(overlay: SimOverlay): void {
	if (linked.has(overlay) || dbMode() !== 'postgres') return;
	linked.add(overlay);
	linkOverlay(overlay, {
		send: (w) => {
			sql()
				.notify(OVERLAY_CHANNEL, JSON.stringify(w))
				.catch((e) => log.warn('overlay.notify_failed', { error: errMsg(e) }));
		},
		listen: (fn) => {
			sql()
				.listen(OVERLAY_CHANNEL, (payload) => {
					try {
						fn(JSON.parse(payload) as OverlayWire);
					} catch (e) {
						log.warn('overlay.bad_payload', { error: errMsg(e) });
					}
				})
				.catch((e) => log.error('overlay.listen_failed', { error: errMsg(e) }));
		}
	});
}
