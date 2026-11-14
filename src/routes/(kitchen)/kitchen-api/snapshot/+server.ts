import { json } from '@sveltejs/kit';
import { focusPlan, snapshot } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * Everything the kitchen screen renders, from the real plan. A read: it never plans or proposes. `?plan=<id>`
 * opens that plan (an approval link from MCP, chat or Ops) if this browser's workspace has it.
 */
export const GET: RequestHandler = async (event) => {
	const { workspaceId, own, kind, presenter } = await visitorWorkspace(event, env, dev);
	const visitor = { own, kind, presenter };
	const id = sid(event.cookies);
	const planId = event.url.searchParams.get('plan');
	if (planId) {
		const focused = await focusPlan(
			id,
			workspaceId,
			planId,
			event.url.searchParams.get('peek') === '1',
			visitor
		);
		if (focused) return json(focused);
		return json(
			{
				error: {
					code: 'NOT_FOUND',
					message: `Plan ${planId} is not in this browser's sandbox. It may belong to another sandbox, or it was started over.`,
					retryable: false
				}
			},
			{ status: 404 }
		);
	}
	const kitchen = event.url.searchParams.get('kitchen') ?? undefined;
	return json(await snapshot(id, workspaceId, visitor, kitchen));
};
