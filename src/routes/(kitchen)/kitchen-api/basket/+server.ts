import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { basketFor } from '$lib/core/services/basket';
import { EVENT_SEED_BY_ID } from '$lib/kitchen/events';
import { runStages } from '$lib/server/demo/run-ops';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { createServerPorts } from '$lib/server/store/server-ports';
import { planTitle } from '../../../ops/orders';
import type { RequestHandler } from './$types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /kitchen-api/basket?kitchen=<id>&date=<YYYY-MM-DD>&from=<YYYY-MM-DD>: the kitchen's basket in this browser's
 * workspace, every open plan merged per delivery day (core/services/basket.ts). A read: approving and ordering stay
 * per plan through the existing commands. Shares Ops' cached projection of the run.
 */
export const GET: RequestHandler = async (event) => {
	const kitchenId = event.url.searchParams.get('kitchen');
	if (!kitchenId) error(400, 'kitchen is required, e.g. ?kitchen=k-hotel');
	const date = event.url.searchParams.get('date') ?? undefined;
	const from = event.url.searchParams.get('from') ?? undefined;
	if ((date && !DAY.test(date)) || (from && !DAY.test(from))) error(400, 'dates are YYYY-MM-DD');
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const { ports } = await createServerPorts();
	const kitchen = (await ports.store.kitchens(workspaceId)).find((k) => k.id === kitchenId);
	if (!kitchen) error(404, `no kitchen ${kitchenId} in this sandbox`);
	const { stages, truncated } = await runStages(workspaceId);
	const basket = basketFor(stages, kitchenId, {
		date,
		from,
		weeklyCapCents: kitchen.mandate.weeklyCapCents ?? null,
		// The event's own name for event plans; otherwise what was asked, in words.
		title: (s) =>
			(s.plan.eventId ? EVENT_SEED_BY_ID[s.plan.eventId]?.title : undefined) ?? planTitle(s)
	});
	return json({ ...basket, truncated }, { headers: { 'cache-control': 'no-store' } });
};
