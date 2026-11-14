import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { findingsFor, servedPorts } from '$lib/server/web';
import { authed, body, fail, providerFail } from '$lib/server/web/route';
import { busTrace, replayRecorded } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/replay (chef or approver key): plays a recorded real Ruokavirasto notice into the
 * current run, labelled "Replay of the <date> recall". Body: `{ url?, drillProductId? }`; the default is
 * the 9 Oct 2026 egg recall. `drillProductId` re-targets the notice at that catalogue product's GTIN
 * and labels it DRILL, so a held line can be shown on stage.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = authed(request, env, dev, 'web:replay', ['chef', 'approver']);
	if (ctx instanceof Response) return ctx;
	const b = await body<{ url?: string; drillProductId?: string }>(request);
	if (b instanceof Response) return b;
	try {
		const ports = await servedPorts();
		let drillGtin: string | undefined;
		if (b.drillProductId) {
			const p = (await ports.catalog.get([b.drillProductId])).get(b.drillProductId);
			if (!p?.gtin) return fail('INVALID_INPUT', `no GTIN for product ${b.drillProductId}`, 400);
			drillGtin = p.gtin;
		}
		busTrace(ports.scope, { lane: 'web' })('step', {
			source: 'context.dev',
			model: 'replay',
			purpose: drillGtin ? 'drill' : 'replay'
		});
		const r = await replayRecorded(
			{ ...ports, findings: findingsFor(env), actor: ctx.actor },
			{ url: b.url, drillGtin }
		);
		return json(r);
	} catch (e) {
		return providerFail(e);
	}
};
