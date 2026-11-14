import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { findingsFor, scopeOf, webClients, webContext } from '$lib/server/web';
import { factsEvidence } from '$lib/server/web/evidence';
import { lookupFacts } from '$lib/server/web/lookup';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/evidence (any key): `{ productId, question? }` → the Why drawer's web evidence for one product:
 * what the catalogue says ("Valio has no allergen record"), then each web field with its citations, quotes and
 * whether a cited page names the product's GTIN, labelled live / cache / replay. Read-only; counts against the
 * caller's daily web cap (429 with Retry-After when reached).
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:evidence');
	if (ctx instanceof Response) return ctx;
	const b = await body<{ productId?: unknown; question?: unknown }>(request);
	if (b instanceof Response) return b;
	if (typeof b.productId !== 'string' || !b.productId)
		return fail('INVALID_INPUT', 'productId is required', 400);
	try {
		const w = await webContext(ctx);
		const { exa } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
		const r = await lookupFacts(
			{
				productId: b.productId,
				question: typeof b.question === 'string' ? b.question : undefined
			},
			{ exa, catalog: w.ports.catalog, findings: findingsFor(env), workspaceId: ctx.workspaceId }
		);
		return json(factsEvidence(r));
	} catch (e) {
		return providerFail(e);
	}
};
