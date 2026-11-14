import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { ICS_HEADERS, kitchenCalendar } from '$lib/server/calendar';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/calendar.ics?kitchen=<id>: the kitchen's decisions, deliveries, receiving days and holidays
 * as an iCalendar feed, in this browser's own workspace (its cookie). For a calendar app that can't send the
 * cookie, /api/calendar/<kitchen>.ics?token=<calendar token> (from /api/demo/calendar-link) serves the same feed.
 */
export const GET: RequestHandler = async (event) => {
	const kitchen = event.url.searchParams.get('kitchen');
	if (!kitchen) error(400, 'kitchen is required, e.g. ?kitchen=k-hotel');
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const ics = await kitchenCalendar(workspaceId, kitchen);
	if (!ics) error(404, `no kitchen ${kitchen} in this sandbox`);
	return new Response(ics, { headers: ICS_HEADERS });
};
