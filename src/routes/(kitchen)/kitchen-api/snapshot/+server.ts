import { json } from '@sveltejs/kit';
import { snapshot } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/** Everything the kitchen screen renders, from the real plan. A read: it never plans or proposes. */
export const GET: RequestHandler = async (event) => {
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	return json(await snapshot(sid(event.cookies), workspaceId));
};
