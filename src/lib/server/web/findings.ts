/**
 * Durable record of what the web lane found, keyed by stable ids (`recall:<noticeKey>`,
 * `facts:<productId>`, `outside:<slug>`). The op log carries the same findings as ops; this file is what
 * a reload reads until the store has an enrichments/anomalies projection of its own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Finding {
	id: string;
	kind: 'recall' | 'facts' | 'outside';
	/** When it was found (wall clock). */
	at: string;
	title: string;
	/** URLs the finding rests on. */
	sources: string[];
	/** Seqs of the ops it produced in the run it was recorded in. */
	ops?: { runId: string; seqs: number[] }[];
	data: unknown;
}

const g = globalThis as typeof globalThis & { __webFindings?: Map<string, Finding> };

/** `fresh` gives a private map (tests); otherwise one map per process, shared by every route. */
export function createFindings(file?: string, fresh = false) {
	const map: Map<string, Finding> = fresh ? new Map() : (g.__webFindings ??= new Map());
	if (file && existsSync(file) && map.size === 0) {
		try {
			for (const f of JSON.parse(readFileSync(file, 'utf8')) as Finding[]) map.set(f.id, f);
		} catch {
			// A corrupt file starts empty; the op log still has every finding.
		}
	}
	const flush = () => {
		if (!file) return;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify([...map.values()], null, 1));
	};
	return {
		get: (id: string) => map.get(id),
		list: (kind?: Finding['kind']) =>
			[...map.values()]
				.filter((f) => !kind || f.kind === kind)
				.sort((a, b) => b.at.localeCompare(a.at)),
		put(f: Finding) {
			const prev = map.get(f.id);
			map.set(f.id, { ...f, ops: mergeOps(prev?.ops, f.ops) });
			flush();
		}
	};
}

function mergeOps(a: Finding['ops'] = [], b: Finding['ops'] = []) {
	const out = new Map(a.map((x) => [x.runId, x.seqs]));
	for (const x of b) out.set(x.runId, [...new Set([...(out.get(x.runId) ?? []), ...x.seqs])]);
	return [...out].map(([runId, seqs]) => ({ runId, seqs }));
}

export type Findings = ReturnType<typeof createFindings>;
