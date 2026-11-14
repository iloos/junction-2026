import type { OpEnvelope } from '$lib/core/contracts';
import { catchUp } from '$lib/server/bus';
import { ensureRunLoaded } from './reset';

const PAGE = 1000;
const MAX_PAGES = 20;

/** A workspace's current run as its whole op log, in seq order (at most PAGE × MAX_PAGES ops). */
export async function readRunOps(workspaceId: string): Promise<OpEnvelope[]> {
	const runId = await ensureRunLoaded(workspaceId);
	const ops: OpEnvelope[] = [];
	let after = 0;
	for (let i = 0; i < MAX_PAGES; i++) {
		const page = await catchUp(workspaceId, after, PAGE, runId);
		for (const e of page) if (e.kind === 'op') ops.push(e.envelope);
		const top = page.reduce((m, e) => ('seq' in e ? Math.max(m, e.seq) : m), after);
		if (page.length < PAGE || top === after) break;
		after = top;
	}
	return ops;
}
