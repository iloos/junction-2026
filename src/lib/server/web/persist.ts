/**
 * The web lane's state maps (findings, the recall work queue, the application ledger): process maps read
 * synchronously, persisted two ways. A JSON file next to the response cache (dev, tests) is read whole and
 * written whole; with Postgres attached (`attachStateSink`, migration 0004) every changed or removed item is
 * written through to its table, and `hydrateSlot` loads the table into the map on first use. Failed writes stay
 * dirty for the next flush; `stateWrites` rejects until the affected slots have been persisted successfully.
 */
import { readJson, writeJson } from '../external/persist';
import type { WebSlot } from './pg-state';
import { errMsg, log } from '$lib/server/obs/log';

export { readJson, writeJson };

/** Where changed items go when Postgres holds the web state. */
export interface StateSink {
	upsert(slot: WebSlot, id: string, doc: Record<string, unknown>): Promise<void>;
	remove(slot: WebSlot, id: string): Promise<void>;
}

const g = globalThis as unknown as Record<string, unknown> & {
	__webSink?: StateSink | null;
	__webSaved?: Map<string, Map<string, string>>;
	__webWrites?: Promise<void>;
	__webWriteErrors?: Map<WebSlot, unknown>;
	__webTouched?: Map<WebSlot, Set<string>>;
	__webFlushers?: Map<WebSlot, () => void>;
};
const saved = (g.__webSaved ??= new Map<string, Map<string, string>>());
const errors = (g.__webWriteErrors ??= new Map<WebSlot, unknown>());
const touched = (g.__webTouched ??= new Map<WebSlot, Set<string>>());
const flushers = (g.__webFlushers ??= new Map<WebSlot, () => void>());

export function attachStateSink(sink: StateSink | null) {
	g.__webSink = sink;
	if (!sink) {
		saved.clear();
		errors.clear();
		touched.clear();
		flushers.clear();
	}
}

/** Resolves only when writes so far are durable; a failed slot stays failed until a successful retry. */
export async function stateWrites(): Promise<void> {
	await g.__webWrites;
	if (errors.size) throw new AggregateError([...errors.values()], 'Web state persistence failed');
}

/** Retry previously failed slots even when the next webhook changes a different kind of state. */
export async function retryStateWrites(): Promise<void> {
	for (const slot of errors.keys()) flushers.get(slot)?.();
	await stateWrites();
}

/** Loads stored items into a map without overwriting what this process already changed. */
export function hydrateSlot<T>(
	slot: WebSlot,
	map: Map<string, T>,
	docs: unknown[],
	keyOf: (x: T) => string
) {
	const known = saved.get(slot) ?? new Map<string, string>();
	saved.set(slot, known);
	for (const d of docs as T[]) {
		const k = keyOf(d);
		if (!map.has(k)) map.set(k, d);
		// The database value is the durable baseline, even when a newer local edit wins in memory.
		known.set(k, JSON.stringify(d));
	}
}

/** A process-wide map loaded once from `file` (items keyed by `keyOf`); `fresh` gives a private one. */
export function persistedMap<T>(
	slot: WebSlot,
	file: string | undefined,
	keyOf: (x: T) => string,
	fresh = false
): { map: Map<string, T>; flush: () => void } {
	const map = fresh ? new Map<string, T>() : ((g[slot] as Map<string, T>) ??= new Map<string, T>());
	if (map.size === 0) for (const x of readJson<T[]>(file, [])) map.set(keyOf(x), x);
	const flush = () => {
		writeJson(file, [...map.values()]);
		const sink = g.__webSink;
		if (fresh || !sink) return;
		const known = saved.get(slot) ?? new Map<string, string>();
		saved.set(slot, known);
		const attempted = touched.get(slot) ?? new Set<string>();
		touched.set(slot, attempted);
		// Capture now: later mutations must not change an already queued write.
		const snapshot = new Map([...map].map(([k, v]) => [k, JSON.stringify(v)]));
		g.__webWrites = (g.__webWrites ?? Promise.resolve()).then(async () => {
			const writes: Promise<void>[] = [];
			for (const [k, json] of snapshot) {
				if (known.get(k) === json && !attempted.has(k)) continue;
				attempted.add(k);
				writes.push(
					Promise.resolve()
						.then(() => sink.upsert(slot, k, JSON.parse(json)))
						.then(() => {
							known.set(k, json);
							attempted.delete(k);
						})
				);
			}
			// A failed upsert may have reached the database before its acknowledgement was lost.
			for (const k of new Set([...known.keys(), ...attempted]))
				if (!snapshot.has(k))
					writes.push(
						Promise.resolve()
							.then(() => sink.remove(slot, k))
							.then(() => {
								known.delete(k);
								attempted.delete(k);
							})
					);
			const results = await Promise.allSettled(writes);
			const failed = results.filter((r) => r.status === 'rejected');
			if (failed.length) {
				const error = new AggregateError(
					failed.map((r) => r.reason),
					'Web state write failed'
				);
				errors.set(slot, error);
				log.error('web.state_write_failed', {
					slot,
					error: errMsg(failed[0].reason),
					failed: failed.length
				});
			} else errors.delete(slot);
		});
	};
	if (!fresh) flushers.set(slot, flush);
	return { map, flush };
}
