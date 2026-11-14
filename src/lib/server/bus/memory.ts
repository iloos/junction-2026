import type { ServerEvent } from '$lib/core/contracts';
import { errMsg, log } from '$lib/server/obs/log';

type Listener = (e: ServerEvent) => void;
type Seqd = Extract<ServerEvent, { seq: number }>;

/** Events kept per workspace for catch-up of things that are not in the op log (sim events). */
export const RING_SIZE = 500;
/**
 * Rings kept at once. With a sandbox per visitor, rings of workspaces nobody is watching are dropped, least
 * recently written first; ops stay in the database, so only sim events of an idle sandbox are forgotten.
 */
const MAX_RINGS = 60;

export const hasSeq = (e: ServerEvent): e is Seqd => 'seq' in e;

/**
 * In-process fan-out: a ring of the last RING_SIZE sequenced events per workspace plus live listeners.
 * Used on its own in fixture mode, and as the local delivery stage behind Postgres NOTIFY.
 */
export class MemoryBus {
	private rings = new Map<string, Seqd[]>();
	private listeners = new Map<string, Set<Listener>>();
	private maxSeq = new Map<string, number>();

	deliver(workspaceId: string, events: ServerEvent[]): void {
		const ring = this.rings.get(workspaceId) ?? [];
		for (const e of events) {
			if (hasSeq(e)) {
				if (ring.some((r) => r.seq === e.seq)) continue;
				ring.push(e);
				if (e.seq > (this.maxSeq.get(workspaceId) ?? 0)) this.maxSeq.set(workspaceId, e.seq);
			}
			for (const fn of this.listeners.get(workspaceId) ?? []) {
				try {
					fn(e);
				} catch (err) {
					log.error('bus.listener_failed', { error: errMsg(err) });
				}
			}
		}
		ring.sort((a, b) => a.seq - b.seq);
		if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
		this.rings.delete(workspaceId); // most recently written last
		this.rings.set(workspaceId, ring);
		if (this.rings.size > MAX_RINGS) this.evict();
	}

	/** Drop the least recently written rings that have no listeners, down to MAX_RINGS. */
	private evict(): void {
		for (const ws of this.rings.keys()) {
			if (this.rings.size <= MAX_RINGS) return;
			if (!this.listeners.has(ws)) this.rings.delete(ws);
		}
	}

	/** Sequenced events with seq > after, oldest first. */
	after(workspaceId: string, after: number): Seqd[] {
		return (this.rings.get(workspaceId) ?? []).filter((e) => e.seq > after);
	}

	highestSeq(workspaceId: string): number {
		return this.maxSeq.get(workspaceId) ?? 0;
	}

	subscribe(workspaceId: string, fn: Listener): () => void {
		const set = this.listeners.get(workspaceId) ?? new Set();
		set.add(fn);
		this.listeners.set(workspaceId, set);
		return () => {
			set.delete(fn);
			if (!set.size) this.listeners.delete(workspaceId);
		};
	}

	listenerCount(workspaceId: string): number {
		return this.listeners.get(workspaceId)?.size ?? 0;
	}

	/** Forget a workspace's ring (a fresh load-test run). */
	reset(workspaceId: string): void {
		this.rings.delete(workspaceId);
	}
}
