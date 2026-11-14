/**
 * The web lane's small JSON files next to the response cache (findings, the recall work queue, the
 * application ledger, the spend ledger, cached responses). Read whole, written whole. A missing or
 * corrupt file reads as the fallback; a failed write is logged and the process keeps its memory copy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(file: string | undefined, fallback: T): T {
	if (!file || !existsSync(file)) return fallback;
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

export function writeJson(file: string | undefined, value: unknown): void {
	if (!file) return;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(value));
	} catch (e) {
		console.error('[web] could not write', file, (e as Error)?.message ?? e);
	}
}

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
