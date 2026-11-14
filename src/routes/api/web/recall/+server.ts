import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import {
	applicationsFor,
	findingsFor,
	scopeOf,
	webClients,
	webContext,
	webTools
} from '$lib/server/web';
import { ingestRecall } from '$lib/server/web/ingest';
import { authed, body, fail, providerFail, resultJson } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/recall (any key), in the caller's workspace and run:
 * - `{ productId }`: the `check_recall` tool (watched notices that cite the product; no network).
 * - `{ url, fresh? }`: read one Ruokavirasto notice with Context.dev, match it against the catalogue and
 *   record the anomalies in the caller's run (counts against its key's daily web cap).
 * - `{}`: the authority's recall list, so a caller can pick one.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:recall');
	if (ctx instanceof Response) return ctx;
	const b = await body<{ url?: string; fresh?: boolean; productId?: string }>(request);
	if (b instanceof Response) return b;
	const w = await webContext(ctx);
	if (b.productId)
		return resultJson(await webTools(env).check_recall(w, { productId: b.productId }));
	try {
		const { recalls } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
		if (!b.url)
			return json({
				mode: recalls.mode,
				recalls: await recalls.readList({ maxAgeMs: b.fresh ? 0 : 3_600_000 })
			});
		if (!/^https:\/\/www\.ruokavirasto\.fi\//.test(b.url))
			return fail('INVALID_INPUT', 'url must be a www.ruokavirasto.fi recall notice', 400);
		const notice = await recalls.readNotice(b.url, { maxAgeMs: b.fresh ? 0 : undefined });
		const r = await ingestRecall(notice, {
			store: w.ports.store,
			index: w.index,
			scope: scopeOf(w),
			findings: findingsFor(env),
			applications: applicationsFor(env),
			actor: ctx.actor,
			via: `${ctx.via}:web/recall`
		});
		return json({ mode: recalls.mode, notice, ...r, matches: r.matches.slice(0, 25) });
	} catch (e) {
		return providerFail(e);
	}
};
