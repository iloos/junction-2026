import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { DEMO_WORKSPACE, resetDemoRun } from '$lib/server/demo/reset';
import { json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/** Who may wipe the stage: the kitchen's own people, never an agent. */
const MAY_RESET_STAGE = new Set(['chef', 'approver']);

const forbidden = (message: string) =>
	json({ error: { code: 'FORBIDDEN', message, retryable: false } }, 403);

/**
 * POST /api/demo/reset → `{ workspaceId, runId, previous }`. Starts a fresh run of the key's workspace; tools, the
 * op stream and /ops follow it at once, and old runs stay in the database.
 * - The stage (ws-demo): chef or approver keys only.
 * - Any other workspace a key is bound to (MCP_KEYS `label:actor:key:workspace`, e.g. the deploy smoke's
 *   `ws-smoke`): that key may reset its own workspace, so repeated smokes never pile up spend. External agents never.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	if (ctx.actor.kind === 'external_agent') return forbidden('an outside agent may not reset');
	if (ctx.workspaceId === DEMO_WORKSPACE && !MAY_RESET_STAGE.has(ctx.actor.kind))
		return forbidden('only a chef or approver key may reset the demo');
	const r = await resetDemoRun(ctx.workspaceId);
	return json({ workspaceId: ctx.workspaceId, ...r });
};
