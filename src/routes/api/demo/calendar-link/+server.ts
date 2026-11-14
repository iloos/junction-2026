import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { isVisitorWorkspace, signCalendar } from '$lib/server/demo/visitor-id';
import type { RequestHandler } from './$types';

/**
 * GET /api/demo/calendar-link?kitchen=<id> → `{ url, webcal }`: a subscribe link to this browser's sandbox feed
 * for that kitchen. `webcal` opens the calendar app's subscribe dialog; `url` is the same feed over https.
 */
export const GET: RequestHandler = async (event) => {
	const kitchen = event.url.searchParams.get('kitchen');
	if (!kitchen || !/^[a-z0-9-]{1,40}$/.test(kitchen))
		error(400, 'kitchen is required, e.g. ?kitchen=k-hotel');
	const v = await visitorWorkspace(event, env, dev);
	if (!isVisitorWorkspace(v.workspaceId))
		error(409, 'Calendar links are for your own sandbox; open it with ?ws=mine.');
	const path = `/api/calendar/${kitchen}.ics?token=${encodeURIComponent(signCalendar(v.workspaceId, env))}`;
	const url = `${event.url.origin}${path}`;
	return json(
		{ url, webcal: url.replace(/^https?:/, 'webcal:') },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
