import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { kitchenDays } from '$lib/server/calendar';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /kitchen-api/calendar-days?kitchen=<id>[&from=YYYY-MM-DD&to=YYYY-MM-DD] → `{ now, from, to, days }`: the day
 * picker's days for a kitchen in this browser's own workspace (its cookie), on the scenario clock. Default range:
 * three weeks from the scenario's today. Same facts as the calendar feed (core/calendar.ts).
 */
export const GET: RequestHandler = async (event) => {
	const q = event.url.searchParams;
	const kitchen = q.get('kitchen');
	if (!kitchen || !/^[a-z0-9-]{1,40}$/.test(kitchen))
		error(400, 'kitchen is required, e.g. ?kitchen=k-hotel');
	const from = q.get('from') ?? undefined;
	const to = q.get('to') ?? undefined;
	if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (from && to && to < from))
		error(400, 'from and to are YYYY-MM-DD, from ≤ to');
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const out = await kitchenDays(workspaceId, kitchen, from, to);
	if (!out) error(404, `no kitchen ${kitchen} in this sandbox`);
	return json(out, { headers: { 'cache-control': 'no-store' } });
};
