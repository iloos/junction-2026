import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { judgeKeyFor, judgeKeysOn } from '$lib/server/demo/judge-key';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * GET /api/demo/judge-key (no key; the browser's sandbox cookie) → `{ workspaceId, key, mcpUrl }`: an MCP/REST
 * key that acts as an external agent in this browser's own sandbox, so an outside agent and the kitchen
 * screen work on the same plan. 503 when JUDGE_KEY_SECRET is unset; 409 when the browser isn't in a visitor
 * sandbox (the stage or the shared room have no judge key).
 */
export const GET: RequestHandler = async (event) => {
	if (!judgeKeysOn(env))
		return json(
			{
				error: {
					code: 'JUDGE_KEYS_OFF',
					message: 'Judge keys are turned off: JUDGE_KEY_SECRET is not set on the server.',
					retryable: false
				}
			},
			{ status: 503, headers: NO_STORE }
		);
	const v = await visitorWorkspace(event, env, dev);
	const key = judgeKeyFor(v.workspaceId, env);
	if (!key)
		return json(
			{
				error: {
					code: 'NOT_A_SANDBOX',
					message: `${v.workspaceId} is not a visitor sandbox; open your own with ?ws=mine.`,
					retryable: false
				}
			},
			{ status: 409, headers: NO_STORE }
		);
	return json(
		{ workspaceId: v.workspaceId, key, mcpUrl: `${event.url.origin}/mcp/k/${key}` },
		{ headers: NO_STORE }
	);
};
