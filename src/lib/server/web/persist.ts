/**
 * The web lane's small JSON files next to the response cache (findings, the recall work queue, the
 * application ledger, the spend ledger, cached responses). Read whole, written whole. A missing or
 * corrupt file reads as the fallback; a failed write is logged and the process keeps its memory copy.
 */
import { readJson, writeJson } from '../external/persist';

export { readJson, writeJson };

/** A process-wide map loaded once from `file` (items keyed by `keyOf`); `fresh` gives a private one. */
export function persistedMap<T>(
	slot: string,
	file: string | undefined,
	keyOf: (x: T) => string,
	fresh = false
): { map: Map<string, T>; flush: () => void } {
	const g = globalThis as unknown as Record<string, Map<string, T> | undefined>;
	const map = fresh ? new Map<string, T>() : (g[slot] ??= new Map<string, T>());
	if (map.size === 0) for (const x of readJson<T[]>(file, [])) map.set(keyOf(x), x);
	return { map, flush: () => writeJson(file, [...map.values()]) };
}
