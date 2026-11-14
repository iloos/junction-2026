import { json } from '$lib/server/tools/http';
import { resetSandbox, SANDBOX_WORKSPACE } from '$lib/server/demo/sandbox';
import type { RequestHandler } from './$types';

/**
 * POST /api/demo/sandbox/reset (no key) → `{ workspaceId, runId, previous }`, or 429 `{ retryInMs }`
 * during the cooldown. Starts the judges' sandbox over; the stage (ws-demo) is not reachable from here.
 */
export const POST: RequestHandler = async () => {
	const r = await resetSandbox();
	if (!r.ok)
		return json(
			{
				error: { code: 'RATE_LIMITED', message: 'The sandbox was just reset.', retryable: true },
				retryInMs: r.retryInMs
			},
			429
		);
	return json({ workspaceId: SANDBOX_WORKSPACE, runId: r.runId, previous: r.previous });
};
