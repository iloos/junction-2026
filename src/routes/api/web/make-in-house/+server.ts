import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { findingsFor, scopeOf, webClients, webContext } from '$lib/server/web';
import { makeInHouse } from '$lib/server/web/evidence';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import { withCallScope } from '$lib/server/scope';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/make-in-house (any key): `{ need, context? }` for a need nothing deliverable covers → an outside
 * recipe (Exa, with its source), each ingredient resolved against the catalogue, as a make-in-house proposal
 * that is always `held` for sign-off. Proposes only: nothing is written to a plan.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:make-in-house');
	if (ctx instanceof Response) return ctx;
	return withCallScope(ctx, async () => {
		const b = await body<{ need?: unknown; context?: unknown }>(request);
		if (b instanceof Response) return b;
		const need = typeof b.need === 'string' ? b.need.trim().slice(0, 120) : '';
		if (need.length < 2) return fail('INVALID_INPUT', 'need is required', 400);
		try {
			const w = await webContext(ctx);
			const { exa } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
			return json(
				await makeInHouse(need, {
					exa,
					catalog: w.ports.catalog,
					findings: findingsFor(env),
					workspaceId: ctx.workspaceId,
					...(typeof b.context === 'string' ? { context: b.context.slice(0, 200) } : {})
				})
			);
		} catch (e) {
			return providerFail(e);
		}
	});
};
