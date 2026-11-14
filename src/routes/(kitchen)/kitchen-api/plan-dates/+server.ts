import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { planDates } from '$lib/server/calendar';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/**
 * GET /kitchen-api/plan-dates?plan=<id>[&format=ics]: one plan's own dates as events to add (not a subscription):
 * "Decide by" with an alarm 2 h before, and the delivery day. JSON (titles, times, Google's add-event link) by
 * default; `format=ics` downloads the file. In this browser's own workspace.
 */
export const GET: RequestHandler = async (event) => {
	const planId = event.url.searchParams.get('plan');
	if (!planId || planId.length > 120) error(400, 'plan is required, e.g. ?plan=<id>');
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const out = await planDates(workspaceId, planId, event.url.origin);
	if (!out) error(404, 'no such plan in this sandbox');
	if (event.url.searchParams.get('format') === 'ics')
		return new Response(out.ics, {
			headers: {
				'content-type': 'text/calendar; charset=utf-8',
				'content-disposition': 'attachment; filename="plan-dates.ics"',
				'cache-control': 'no-store'
			}
		});
	return json(
		{
			decide: out.dates.decide,
			deliverBy: out.dates.plan.deliverBy,
			decideTitle: out.decideTitle,
			deliveryTitle: out.deliveryTitle,
			google: out.google
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
