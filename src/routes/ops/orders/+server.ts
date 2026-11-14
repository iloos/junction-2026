import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isMemoryOnly } from '$lib/server/bus';
import { runStages } from '$lib/server/demo/run-ops';
import { mayRead } from '$lib/server/demo/visitor';
import { decisionsOf } from '$lib/ui/decisions';
import { orderRow } from '../orders';
import type { RequestHandler } from './$types';

/**
 * GET /ops/orders?ws=<workspace> → `{ orders: OrderRow[] }`: every plan of the current run as its four stages
 * (core/services/stages.ts), built from the whole op log. Read-only; the same readers as /api/events.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const ws = url.searchParams.get('ws') ?? '';
	if (!ws || (!dev && !mayRead(ws, cookies, env)))
		return json({ error: { code: 'FORBIDDEN', message: 'unknown workspace' } }, { status: 403 });
	if (isMemoryOnly(ws)) return json({ orders: [] });
	const { stages, truncated } = await runStages(ws);
	return json(
		{ orders: stages.map((s) => orderRow(s, decisionsOf(s.plan, s.pending))), truncated },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
