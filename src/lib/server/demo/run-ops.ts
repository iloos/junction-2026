import type { OpEnvelope } from '$lib/core/contracts';
import { allOrderStages, type OrderStages } from '$lib/core/services/stages';
import { catchUp } from '$lib/server/bus';
import { ensureRunLoaded } from './reset';

const PAGE = 1000;
const MAX_PAGES = 20;
/**
 * History policy: Ops projects at most this many ops of a run (the newest run is short-lived; a demo run is a
 * few hundred). Past it the projection says `truncated` instead of silently reading a prefix as the whole.
 */
export const MAX_RUN_OPS = PAGE * MAX_PAGES;

/** A workspace's current run as its op log, in seq order, at most MAX_RUN_OPS. */
export async function readRunOps(
	workspaceId: string
): Promise<{ runId: string; ops: OpEnvelope[]; truncated: boolean }> {
	const runId = await ensureRunLoaded(workspaceId);
	const ops: OpEnvelope[] = [];
	let after = 0;
	let truncated = true;
	for (let i = 0; i < MAX_PAGES; i++) {
		const page = await catchUp(workspaceId, after, PAGE, runId);
		for (const e of page) if (e.kind === 'op') ops.push(e.envelope);
		const top = page.reduce((m, e) => ('seq' in e ? Math.max(m, e.seq) : m), after);
		if (page.length < PAGE || top === after) {
			truncated = false;
			break;
		}
		after = top;
	}
	return { runId, ops, truncated };
}

const g = globalThis as typeof globalThis & {
	__mandateStages?: Map<string, { key: string; stages: OrderStages[]; truncated: boolean }>;
};
const cache = (g.__mandateStages ??= new Map());

/**
 * Every plan of the current run as its order stages (core/services/stages.ts), projected once per
 * workspace, run and last seq: Orders and Demand read the same projection, and it is rebuilt only when the log
 * has moved.
 */
export async function runStages(
	workspaceId: string
): Promise<{ stages: OrderStages[]; truncated: boolean }> {
	const { runId, ops, truncated } = await readRunOps(workspaceId);
	const key = `${runId}|${ops.at(-1)?.seq ?? 0}|${ops.length}`;
	const hit = cache.get(workspaceId);
	if (hit?.key === key) return hit;
	const out = { key, stages: allOrderStages(ops), truncated };
	cache.set(workspaceId, out);
	if (cache.size > 500) cache.delete(cache.keys().next().value!);
	return out;
}
