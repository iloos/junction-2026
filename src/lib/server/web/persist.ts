/**
 * The web lane's state maps (findings, the recall work queue, the application ledger): process maps read
 * synchronously, persisted two ways. A JSON file next to the response cache (dev, tests) is read whole and
 * written whole; with Postgres attached (`attachStateSink`, migration 0004) every changed or removed item is
 * written through to its table, and `hydrateSlot` loads the table into the map on first use. A failed write
 * is logged and the process keeps its memory copy.
 */
import { readJson, writeJson } from '../external/persist';
import type { WebSlot } from './pg-state';

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
};
const saved = (g.__webSaved ??= new Map<string, Map<string, string>>());

export function attachStateSink(sink: StateSink | null) {
	g.__webSink = sink;
}

/** Resolves when every write-through so far has settled (a webhook awaits it before its 202). */
export function stateWrites(): Promise<void> {
	return g.__webWrites ?? Promise.resolve();
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
		known.set(k, JSON.stringify(map.get(k)));
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
		const writes: Promise<void>[] = [];
		for (const [k, v] of map) {
			const json = JSON.stringify(v);
			if (known.get(k) === json) continue;
			known.set(k, json);
			writes.push(sink.upsert(slot, k, v as Record<string, unknown>));
		}
		for (const k of [...known.keys()])
			if (!map.has(k)) {
				known.delete(k);
				writes.push(sink.remove(slot, k));
			}
		if (!writes.length) return;
		const done = Promise.all(writes).then(
			() => {},
			(e) => console.error('[web] state write failed', slot, (e as Error)?.message ?? e)
		);
		g.__webWrites = (g.__webWrites ?? Promise.resolve()).then(() => done);
	};
	return { map, flush };
}
