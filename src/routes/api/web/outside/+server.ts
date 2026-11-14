import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { webContext, webTools } from '$lib/server/web';
import { authed, body, resultJson } from '$lib/server/web/route';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/outside (any key): the `find_outside` tool over REST. `{ need, amount? }`, e.g.
 * `{ need: "joulutorttu", amount: { value: 140, unit: "pcs" } }` → options outside the catalogue, each
 * with its source. Never ordered; runs in the caller's workspace under its key's daily web cap.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:outside');
	if (ctx instanceof Response) return ctx;
	const b = await body(request);
	if (b instanceof Response) return b;
	return resultJson(await webTools(env).find_outside(await webContext(ctx), b));
};
