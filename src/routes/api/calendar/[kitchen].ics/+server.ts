import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveKey } from '$lib/server/auth';
import { ICS_HEADERS, kitchenCalendar } from '$lib/server/calendar';
import { readCalendar } from '$lib/server/demo/visitor-id';
import type { RequestHandler } from './$types';

/**
 * GET /api/calendar/<kitchen>.ics?token=<calendar token>: the same feed as /kitchen-api/calendar.ics, for a
 * calendar app that subscribes by URL. The token (from /api/demo/calendar-link) reads one sandbox's feed and
 * nothing else. Scripts may use an agent key, but only as a Bearer header: a key that can plan and order never
 * goes in a URL that calendars sync.
 */
export const GET: RequestHandler = async ({ params, url, request }) => {
	const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
	const workspaceId =
		readCalendar(url.searchParams.get('token'), env) ??
		(bearer ? resolveKey(bearer, env, { dev, via: 'calendar' })?.workspaceId : undefined);
	if (!workspaceId) error(401, 'a calendar token is required: ?token=<token>');
	const ics = await kitchenCalendar(workspaceId, params.kitchen);
	if (!ics) error(404, `no kitchen ${params.kitchen} in this workspace`);
	return new Response(ics, { headers: ICS_HEADERS });
};
