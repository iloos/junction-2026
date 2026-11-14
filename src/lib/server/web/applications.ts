/**
 * Where each recall notice has been applied: one record per workspace, run and notice identity, with the
 * notice revision it applied and its retry state. A notice is read once (findings are about the source);
 * applying it is per target, so a new run or another workspace gets it from the stored read without a
 * second paid call, and an amended notice is an update only for targets that saw the earlier revision.
 */
import { persistedMap } from './persist';

export interface Application {
	key: string;
	workspaceId: string;
	runId: string;
	findingId: string;
	/** Last revision applied (state `applied`) or tried (state `failed`). */
	revision: string;
	/** The revision last applied successfully, which the next update is diffed against. */
	appliedRevision?: string;
	state: 'applied' | 'failed';
	at: string;
	seqs: number[];
	attempts: number;
	lastError?: string;
}

/** A failed application is retried until it has failed this often. */
export const MAX_APPLY_ATTEMPTS = 5;

type Target = { workspaceId: string; runId: string };
const keyOf = (t: Target, findingId: string) => `${t.workspaceId}/${t.runId}/${findingId}`;

export function createApplications(file?: string, fresh = false) {
	// A lost ledger starts empty: re-applying is idempotent per run (anomaly ids).
	const { map, flush } = persistedMap<Application>('__webApplications', file, (a) => a.key, fresh);
	return {
		get: (t: Target, findingId: string) => map.get(keyOf(t, findingId)),
		applied(t: Target, findingId: string, revision: string, seqs: number[], at: string) {
			const key = keyOf(t, findingId);
			const prev = map.get(key);
			map.set(key, {
				key,
				...t,
				findingId,
				revision,
				appliedRevision: revision,
				state: 'applied',
				at,
				seqs: [...new Set([...(prev?.seqs ?? []), ...seqs])],
				attempts: 0
			});
			flush();
		},
		failed(t: Target, findingId: string, revision: string, error: string, at: string) {
			const key = keyOf(t, findingId);
			const prev = map.get(key);
			map.set(key, {
				key,
				...t,
				findingId,
				revision,
				...(prev?.appliedRevision ? { appliedRevision: prev.appliedRevision } : {}),
				state: 'failed',
				at,
				seqs: prev?.seqs ?? [],
				attempts: (prev?.state === 'failed' ? prev.attempts : 0) + 1,
				lastError: error.slice(0, 300)
			});
			flush();
		},
		/** Applications in one workspace (optionally one run), newest first. */
		list: (workspaceId: string, runId?: string) =>
			[...map.values()]
				.filter((a) => a.workspaceId === workspaceId && (!runId || a.runId === runId))
				.sort((a, b) => b.at.localeCompare(a.at))
	};
}

export type Applications = ReturnType<typeof createApplications>;
