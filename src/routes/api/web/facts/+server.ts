import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { callerKey, findingsFor, servedPorts, webClients } from '$lib/server/web';
import { lookupFacts } from '$lib/server/web/lookup';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/facts (any key): `{ productId }` or `{ query }` → web suggestions for missing facts
 * (allergens, may-contain, net content, origin, ingredients), each with source URLs, quotes and whether
 * the page names the product's GTIN. With a productId they are recorded as RecordEnrichment ops.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:facts');
	if (ctx instanceof Response) return ctx;
	const b = await body<{ productId?: string; query?: string }>(request);
	if (b instanceof Response) return b;
	if (!b.productId && !b.query) return fail('INVALID_INPUT', 'give a productId or a query', 400);
	try {
		const ports = await servedPorts();
		const { exa } = webClients(env, busTrace(ports.scope, { lane: 'web' }), callerKey(ctx.actor));
		return json(
			await lookupFacts(
				{ productId: b.productId, query: b.query?.slice(0, 200) },
				{
					exa,
					catalog: ports.catalog,
					findings: findingsFor(env),
					store: ports.store,
					scope: ports.scope,
					actor: ctx.actor,
					via: `${ctx.via}:web/facts`
				}
			)
		);
	} catch (e) {
		return providerFail(e);
	}
};
