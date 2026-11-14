import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { resetDemo } from '$lib/server/demo/reset';
import { json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/** Who may wipe the stage: the kitchen's own people, never an agent. */
const MAY_RESET = new Set(['chef', 'approver']);

/**
 * POST /api/demo/reset → `{ runId, previous }`. Starts a fresh run of the demo workspace; tools, the op
 * stream and /ops follow it at once. Old runs stay in the database.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	if (!MAY_RESET.has(ctx.actor.kind))
		return json(
			{
				error: {
					code: 'FORBIDDEN',
					message: 'only a chef or approver key may reset the demo',
					retryable: false
				}
			},
			403
		);
	return json(await resetDemo());
};
