import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { contextFor } from '$lib/server/auth';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { cardFor } from '$lib/server/products';
import { simToday } from '$lib/server/request';
import { withCallScope } from '$lib/server/scope';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/product/<id>?deliverBy=YYYY-MM-DD: the product card the ProductToken opens, in this browser's
 * own workspace (no key). Read-only; a live listing lookup is charged to the visitor's daily web cap.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!/^\d{4,10}$/.test(id))
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'unknown product id' } },
			{ status: 400 }
		);
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const ctx = contextFor('chef', 'kitchen-ui', 'kitchen', env, workspaceId);
	return withCallScope(ctx, async () => {
		const q = event.url.searchParams.get('deliverBy') ?? '';
		const deliverBy = /^\d{4}-\d\d-\d\d$/.test(q) ? q : await simToday(workspaceId);
		const card = await cardFor(env, ctx, id, deliverBy);
		return card
			? json(card, { headers: { 'cache-control': 'private, max-age=60' } })
			: json({ error: { code: 'NOT_FOUND', message: `no product ${id}` } }, { status: 404 });
	});
};
