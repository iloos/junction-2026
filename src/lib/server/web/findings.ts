/**
 * Durable record of what the web lane found, keyed by stable ids (`recall:<noticeKey>`,
 * `facts:<productId>`, `outside:<slug>`). The op log carries the same findings as ops; this file is what
 * a reload reads until the store has an enrichments/anomalies projection of its own.
 */
import { persistedMap } from './persist';

export interface Finding {
	id: string;
	kind: 'recall' | 'facts' | 'outside' | 'listing';
	/** When it was found (wall clock). */
	at: string;
	title: string;
	/** URLs the finding rests on. */
	sources: string[];
	/**
	 * Set when the finding belongs to one workspace (a drill, a caller's lookup); absent for a public
	 * source read (a real recall notice), which every workspace may see.
	 */
	workspaceId?: string;
	/** Seqs of the ops it produced in the run it was recorded in. */
	ops?: { runId: string; seqs: number[] }[];
	data: unknown;
}

/** `fresh` gives a private map (tests); otherwise one map per process, shared by every route. */
export function createFindings(file?: string, fresh = false) {
	// A lost file starts empty; the op log still has every recorded finding.
	const { map, flush } = persistedMap<Finding>('__webFindings', file, (f) => f.id, fresh);
	return {
		get: (id: string) => map.get(id),
		/** Newest first; with `workspaceId`, only public findings and that workspace's own. */
		list: (kind?: Finding['kind'], workspaceId?: string) =>
			[...map.values()]
				.filter((f) => !kind || f.kind === kind)
				.filter((f) => !workspaceId || !f.workspaceId || f.workspaceId === workspaceId)
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
