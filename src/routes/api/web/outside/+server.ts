import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { findingsFor, servedPorts, webClients } from '$lib/server/web';
import { findOutside } from '$lib/server/web/lookup';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/outside (any key): `{ need, context? }`, e.g. `{ need: "joulutorttu", context: "140-guest
 * buffet" }` → recipes or alternatives from the web with sources, each ingredient matched to catalogue
 * products the kitchen can order.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:outside');
	if (ctx instanceof Response) return ctx;
	const b = await body<{ need?: string; context?: string }>(request);
	if (b instanceof Response) return b;
	if (!b.need?.trim()) return fail('INVALID_INPUT', 'give a need', 400);
	try {
		const ports = await servedPorts();
		const { exa } = webClients(env, busTrace(ports.scope, { lane: 'web' }));
		return json(
			await findOutside(b.need.trim().slice(0, 120), {
				exa,
				catalog: ports.catalog,
				findings: findingsFor(env),
				context: b.context?.slice(0, 200)
			})
		);
	} catch (e) {
		return providerFail(e);
	}
};
