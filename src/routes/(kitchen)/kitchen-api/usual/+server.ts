import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import {
	parseOverrides,
	parsePeriod,
	planUsual,
	readUsual,
	searchTopUp
} from '$lib/server/patterns/route';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/usual?kitchen=<id>&date=<YYYY-MM-DD>&window=12w&every=<productId>:2w — the usual order for a
 * kitchen and delivery day in this browser's sandbox, from its simulated history. `?q=` instead searches the
 * catalogue for a top-up. Read-only.
 */
export const GET: RequestHandler = async (event) => {
	const p = event.url.searchParams;
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const q = p.get('q');
	if (q !== null) return json({ hits: await searchTopUp(workspaceId, q) });
	const kitchen = p.get('kitchen');
	if (!kitchen) error(400, 'kitchen is required, e.g. ?kitchen=k-hotel');
	const date = p.get('date') ?? undefined;
	if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date is YYYY-MM-DD');
	const usual = await readUsual(workspaceId, kitchen, {
		date,
		window: parsePeriod(p.get('window')) ?? undefined,
		overrides: parseOverrides(p.getAll('every'))
	});
	if (!usual) error(404, `no kitchen ${kitchen} in this sandbox`);
	return json(usual);
};

/** POST {kitchenId, deliveryDate, lines, nonce?}: plan the chef's confirmed lines through place_order as the chef. */
export const POST: RequestHandler = async (event) => {
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const r = await planUsual(workspaceId, await event.request.json().catch(() => ({})));
	return r.ok ? json(r) : json({ error: r.error }, { status: r.status });
};
