import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { contextFor } from '$lib/server/auth';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { webContext } from '$lib/server/web';
import { evidenceFor, makeInHouseFor } from '$lib/server/web/evidence';
import { webError } from '$lib/server/web/spend';
import type { RequestHandler } from './$types';

/**
 * The Why drawer's web evidence for the kitchen screen, which holds no key: read-only Exa lookups as the chef in
 * this browser's own workspace, charged to that workspace's daily web cap.
 * - `evidence` `{ productId }` → what the catalogue lacks and the cited web fields (live / cache / replay).
 * - `make-in-house` `{ need, context? }` → an outside recipe with catalogue ingredients, held for sign-off.
 * Neither writes to a plan.
 */
export const POST: RequestHandler = async (event) => {
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const b = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
	try {
		const w = await webContext(contextFor('chef', 'kitchen-ui', 'kitchen', env, workspaceId));
		const run = { ...w, spendKey: `visitor:${workspaceId}` };
		if (event.params.action === 'evidence') {
			const productId = str(b.productId, 32);
			if (!productId) return bad('productId is required');
			return json(await evidenceFor(run, env, { productId }));
		}
		if (event.params.action === 'make-in-house') {
			const need = str(b.need, 120);
			if (need.length < 2) return bad('need is required');
			const context = str(b.context, 200);
			return json(await makeInHouseFor(run, env, { need, ...(context ? { context } : {}) }));
		}
		return json(
			{ error: { code: 'NOT_FOUND', message: 'unknown action', retryable: false } },
			{ status: 404 }
		);
	} catch (e) {
		const { error } = webError(e);
		const retryAfter = (error.detail as { retryAfter?: number } | undefined)?.retryAfter;
		return json(
			{ error },
			{
				status: retryAfter ? 429 : error.code === 'NOT_FOUND' ? 404 : 503,
				...(retryAfter ? { headers: { 'retry-after': String(retryAfter) } } : {})
			}
		);
	}
};

const bad = (message: string) =>
	json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, { status: 400 });
