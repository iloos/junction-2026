import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { mayStartAgent } from '$lib/server/agent/principal';
import { cancelAgentRun } from '$lib/server/agent/runs';
import { json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent/run/<id>/cancel with a chef key → 202 `{ id, cancelled: true, run }` once the loop has
 * stopped (no tool starts after the abort; a tool already running finishes and is in the run). 404 when that
 * run is not in progress in the caller's workspace. Approver and agent keys may not stop runs.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	if (!mayStartAgent(ctx))
		return json(
			{
				error: {
					code: 'FORBIDDEN',
					message: `${ctx.actor.kind} may not stop the kitchen agent`,
					retryable: false
				}
			},
			403
		);
	const r = cancelAgentRun(params.id, ctx.actor, ctx.workspaceId);
	if (!r.ok)
		return json(
			{
				error: {
					code: 'NOT_FOUND',
					message: `agent run ${params.id} is not in progress`,
					retryable: false
				}
			},
			404
		);
	const run = await r.done.catch(() => null);
	return json({ id: params.id, cancelled: true, run }, 202);
};
