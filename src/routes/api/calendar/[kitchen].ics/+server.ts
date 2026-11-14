import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveKey } from '$lib/server/auth';
import { ICS_HEADERS, kitchenCalendar } from '$lib/server/calendar';
import type { RequestHandler } from './$types';

/**
 * GET /api/calendar/<kitchen>.ics?key=<key>: the same feed as /kitchen-api/calendar.ics, for a calendar app that
 * subscribes by URL. The key (a judge key or an MCP key) picks the workspace; it may only read it.
 */
export const GET: RequestHandler = async ({ params, url, request }) => {
	const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	const ctx = resolveKey(url.searchParams.get('key') || bearer, env, { dev, via: 'calendar' });
	if (!ctx || !ctx.scopes.includes('read')) error(401, 'a valid key is required: ?key=<key>');
	const ics = await kitchenCalendar(ctx.workspaceId, params.kitchen);
	if (!ics) error(404, `no kitchen ${params.kitchen} in this workspace`);
	return new Response(ics, { headers: ICS_HEADERS });
};
