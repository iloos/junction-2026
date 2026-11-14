import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isMemoryOnly } from '$lib/server/bus';
import { runStages } from '$lib/server/demo/run-ops';
import { mayRead } from '$lib/server/demo/visitor';
import { createServerPorts } from '$lib/server/store/server-ports';
import { demandByDay } from '../demand';
import type { RequestHandler } from './$types';

/**
 * GET /ops/demand?ws=<workspace> → `{ days: DemandDay[] }`: Valio's view of the run, per delivery day and product
 * across every kitchen (ops/demand.ts). Read-only, from the op log.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const ws = url.searchParams.get('ws') ?? '';
	if (!ws || (!dev && !mayRead(ws, cookies, env)))
		return json({ error: { code: 'FORBIDDEN', message: 'unknown workspace' } }, { status: 403 });
	if (isMemoryOnly(ws)) return json({ days: [] });
	const { stages, truncated } = await runStages(ws);
	const { ports } = await createServerPorts();
	const kitchens = await ports.store.kitchens(ws).catch(() => []);
	const nameOf = (id: string) => kitchens.find((k) => k.id === id)?.name ?? id;
	return json(
		{ days: demandByDay(stages, nameOf), truncated },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
