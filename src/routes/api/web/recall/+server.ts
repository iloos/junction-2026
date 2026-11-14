import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { callerKey, findingsFor, servedPorts, webClients } from '$lib/server/web';
import { ingestRecall } from '$lib/server/web/ingest';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/recall (any key): read one Ruokavirasto recall notice with Context.dev structured
 * extraction, match it against the catalogue and record the anomalies. Body: `{ url, fresh? }`.
 * Without `url`, returns the authority's recall list so a caller can pick one.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:recall');
	if (ctx instanceof Response) return ctx;
	const b = await body<{ url?: string; fresh?: boolean }>(request);
	if (b instanceof Response) return b;
	try {
		const ports = await servedPorts();
		const { recalls } = webClients(
			env,
			busTrace(ports.scope, { lane: 'web' }),
			callerKey(ctx.actor)
		);
		if (!b.url)
			return json({
				mode: recalls.mode,
				recalls: await recalls.readList({ maxAgeMs: b.fresh ? 0 : 3_600_000 })
			});
		if (!/^https:\/\/www\.ruokavirasto\.fi\//.test(b.url))
			return fail('INVALID_INPUT', 'url must be a www.ruokavirasto.fi recall notice', 400);
		const notice = await recalls.readNotice(b.url, { maxAgeMs: b.fresh ? 0 : undefined });
		const r = await ingestRecall(notice, {
			...ports,
			findings: findingsFor(env),
			actor: ctx.actor,
			via: `${ctx.via}:web/recall`
		});
		return json({ mode: recalls.mode, notice, ...r, matches: r.matches.slice(0, 25) });
	} catch (e) {
		return providerFail(e);
	}
};
