import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { webFactsFor } from '$lib/server/products/facts-warm';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/webfacts?ids=a,b: what the web says about these products' allergens (S4's webFactsFor), for lines
 * with no allergen record. Known findings only, never a live lookup. Evidence for a person: it never clears a "?" or
 * a hold.
 */
export const GET: RequestHandler = async (event) => {
	const ids = (event.url.searchParams.get('ids') ?? '')
		.split(',')
		.filter((id) => /^\d{4,10}$/.test(id))
		.slice(0, 200);
	if (!ids.length) return json({});
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	return json(webFactsFor(env, workspaceId, ids), {
		headers: { 'cache-control': 'private, max-age=60' }
	});
};
