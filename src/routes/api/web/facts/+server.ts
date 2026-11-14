import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { webContext, webTools } from '$lib/server/web';
import { authed, body, resultJson } from '$lib/server/web/route';
import { withCallScope } from '$lib/server/scope';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/facts (any key): the `lookup_facts` tool over REST. `{ productId, question? }` → web
 * facts (allergens, may-contain, net content, origin, ingredients), each with its sources and whether a
 * source cites the product's GTIN. Read-only; runs in the caller's workspace and counts against its key's
 * daily web cap (429 with Retry-After when reached).
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:facts');
	if (ctx instanceof Response) return ctx;
	return withCallScope(ctx, async () => {
		const b = await body(request);
		if (b instanceof Response) return b;
		return resultJson(await webTools(env).lookup_facts(await webContext(ctx), b));
	});
};
