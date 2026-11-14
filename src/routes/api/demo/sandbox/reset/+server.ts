import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resetSandbox } from '$lib/server/demo/sandbox';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * POST /api/demo/sandbox/reset (no key; the browser's sandbox cookie) → `{ workspaceId, runId, previous }`, or
 * 429 `{ retryInMs }` during that sandbox's cooldown. Starts this browser's room over: its own sandbox, a
 * sandbox opened by link, or the shared judges' room. The stage (ws-demo) is not reachable from here (403).
 */
export const POST: RequestHandler = async (event) => {
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const r = await resetSandbox(workspaceId);
	if (r.ok) return json({ workspaceId, runId: r.runId, previous: r.previous });
	if ('forbidden' in r)
		return json(
			{
				error: {
					code: 'FORBIDDEN',
					message: 'The stage run is reset by the presenter only.',
					retryable: false
				}
			},
			{ status: 403 }
		);
	return json(
		{
			error: { code: 'RATE_LIMITED', message: 'The sandbox was just reset.', retryable: true },
			retryInMs: r.retryInMs
		},
		{ status: 429 }
	);
};
