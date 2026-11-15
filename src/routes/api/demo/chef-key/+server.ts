import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { chefKeyFor } from '$lib/server/demo/chef-key';
import { judgeKeysOn } from '$lib/server/demo/judge-key';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * GET /api/demo/chef-key (no key; the browser's sandbox cookie) → `{ workspaceId, key, mcpUrl }`: a key for the
 * chef's own AI client (D22). It acts as this browser's chef in its own sandbox and approves only through an MCP
 * elicitation that shows the exact terms and that the chef accepts. Keys are off without JUDGE_KEY_SECRET (503);
 * the stage and the shared room have none (409).
 */
export const GET: RequestHandler = async (event) => {
	if (!judgeKeysOn(env))
		return json(
			{
				error: {
					code: 'KEYS_OFF',
					message: 'Keys are turned off: JUDGE_KEY_SECRET is not set on the server.',
					retryable: false
				}
			},
			{ status: 503, headers: NO_STORE }
		);
	const v = await visitorWorkspace(event, env, dev);
	const key = chefKeyFor(v.own, env);
	if (!key || v.workspaceId !== v.own)
		return json(
			{
				error: {
					code: 'NOT_A_SANDBOX',
					message: 'Open your own sandbox (?ws=mine) to pair your own AI client as its chef.',
					retryable: false
				}
			},
			{ status: 409, headers: NO_STORE }
		);
	return json(
		{ workspaceId: v.own, key, mcpUrl: `${event.url.origin}/mcp/k/${key}` },
		{ headers: NO_STORE }
	);
};
