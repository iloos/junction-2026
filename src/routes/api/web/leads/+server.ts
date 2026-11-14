import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { scopeOf, webClients, webContext } from '$lib/server/web';
import { supplierLeads } from '$lib/server/web/evidence';
import { authed, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * GET /api/web/leads?planId= (any key): recent news (Context.dev News Search) on the vendors of the caller's
 * open plans, or of one plan, as supplier-risk leads for the Ops card. Leads only: never a hold.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const ctx = authed(request, env, dev, 'web:leads');
	if (ctx instanceof Response) return ctx;
	try {
		const w = await webContext(ctx);
		const state = await w.ports.store.load(ctx.workspaceId, ctx.runId);
		const planId = url.searchParams.get('planId');
		const plans = Object.values(state.plans).filter((p) =>
			planId ? p.id === planId : p.state !== 'committed'
		);
		const ids = [...new Set(plans.flatMap((p) => p.lines.map((l) => l.productId)))];
		const products = ids.length ? await w.ports.catalog.get(ids) : new Map();
		const vendors = [...products.values()].map((p) => p.vendor as string);
		const { news } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
		return json({ workspaceId: ctx.workspaceId, ...(await supplierLeads(vendors, news)) });
	} catch (e) {
		return providerFail(e);
	}
};
