import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { OpEnvelope } from '$lib/core/contracts';
import { allOrderStages } from '$lib/core/services/stages';
import { catchUp, isMemoryOnly } from '$lib/server/bus';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { mayRead } from '$lib/server/demo/visitor';
import { decisionsOf } from '$lib/ui/decisions';
import { orderRow } from '../orders';
import type { RequestHandler } from './$types';

const PAGE = 1000;
const MAX_PAGES = 20;

/**
 * GET /ops/orders?ws=<workspace> → `{ orders: OrderRow[] }`: every plan of the current run as its four stages
 * (core/services/stages.ts), built from the whole op log. Read-only; the same readers as /api/events.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const ws = url.searchParams.get('ws') ?? '';
	if (!ws || (!dev && !mayRead(ws, cookies, env)))
		return json({ error: { code: 'FORBIDDEN', message: 'unknown workspace' } }, { status: 403 });
	if (isMemoryOnly(ws)) return json({ orders: [] });
	const runId = await ensureRunLoaded(ws);
	const ops: OpEnvelope[] = [];
	let after = 0;
	for (let i = 0; i < MAX_PAGES; i++) {
		const page = await catchUp(ws, after, PAGE, runId);
		for (const e of page) if (e.kind === 'op') ops.push(e.envelope);
		const top = page.reduce((m, e) => ('seq' in e ? Math.max(m, e.seq) : m), after);
		if (page.length < PAGE || top === after) break;
		after = top;
	}
	const stages = allOrderStages(ops);
	return json(
		{ orders: stages.map((s) => orderRow(s, decisionsOf(s.plan, s.pending))) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
