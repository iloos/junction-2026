/**
 * Recall work the webhook accepted but hasn't finished: written to disk before the webhook answers
 * 202, removed only when the read and ingest succeed. A crash, a redeploy or a failed read leaves the
 * item here, and the next webhook (`change.detected` or the monitor's `run.completed`) picks it up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WorkItem {
	/** `list` (re-read the recall list) or `notice:<url>`. */
	id: string;
	kind: 'list' | 'notice';
	url?: string;
	/** The change that asked for it, for the trace. */
	change?: string;
	at: string;
	attempts: number;
	lastError?: string;
}

/** After this many failed attempts an item stays visible but is no longer retried. */
export const MAX_ATTEMPTS = 6;

const g = globalThis as typeof globalThis & { __webQueue?: Map<string, WorkItem> };

export function createWorkQueue(file?: string, fresh = false) {
	const map: Map<string, WorkItem> = fresh ? new Map() : (g.__webQueue ??= new Map());
	if (file && existsSync(file) && map.size === 0) {
		try {
			for (const w of JSON.parse(readFileSync(file, 'utf8')) as WorkItem[]) map.set(w.id, w);
		} catch {
			// A corrupt queue starts empty; the next run.completed re-reads the list anyway.
		}
	}
	const flush = () => {
		if (!file) return;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify([...map.values()], null, 1));
	};
	return {
		/** Adds work (idempotent per id: a second change for the same list or notice is one item). */
		add(w: Omit<WorkItem, 'id' | 'attempts' | 'at'> & { at?: string }) {
			const id = w.kind === 'list' ? 'list' : `notice:${w.url}`;
			if (!map.has(id))
				map.set(id, { ...w, id, at: w.at ?? new Date().toISOString(), attempts: 0 });
			flush();
			return id;
		},
		/** Items still worth trying, oldest first. */
		due: () =>
			[...map.values()]
				.filter((w) => w.attempts < MAX_ATTEMPTS)
				.sort((a, b) => a.at.localeCompare(b.at)),
		all: () => [...map.values()],
		has: (id: string) => map.has(id),
		done(id: string) {
			if (map.delete(id)) flush();
		},
		failed(id: string, error: string, w?: Omit<WorkItem, 'id' | 'attempts' | 'at'>) {
			const prev = map.get(id);
			const base: WorkItem = prev ?? {
				...(w ?? { kind: 'notice' }),
				id,
				at: new Date().toISOString(),
				attempts: 0
			};
			map.set(id, { ...base, attempts: base.attempts + 1, lastError: error.slice(0, 300) });
			flush();
		}
	};
}

export type WorkQueue = ReturnType<typeof createWorkQueue>;
