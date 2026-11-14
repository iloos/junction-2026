import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import {
	sameSecret,
	verifyContextSignature,
	type ChangeDetected
} from '$lib/server/web/contextdev';
import { findingsFor, servedPorts, webClients } from '$lib/server/web';
import { fail } from '$lib/server/web/route';
import { busTrace, handleChange } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/contextdev: Context.dev monitor webhook. Accepted when `X-Context-Signature` verifies
 * against CONTEXT_DEV_WEBHOOK_SECRET (Context.dev deliveries) or `x-mandate-webhook-secret` equals it
 * (our scripts). Answers 202 at once; the notices are extracted and recorded in the background, and the
 * resulting anomalies arrive on the op stream.
 */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const secret = env.CONTEXT_DEV_WEBHOOK_SECRET ?? '';
	const signed = verifyContextSignature(raw, request.headers.get('x-context-signature'), secret);
	if (!signed && !sameSecret(request.headers.get('x-mandate-webhook-secret'), secret))
		return fail('FORBIDDEN', 'bad or missing webhook signature', 401);

	let event: ChangeDetected;
	try {
		event = JSON.parse(raw) as ChangeDetected;
	} catch {
		return fail('INVALID_INPUT', 'body is not JSON', 400);
	}
	const ports = await servedPorts();
	if (event.event !== 'change.detected') {
		// run.completed: the monitor checked the page; shown in the trace drawer as "last checked".
		busTrace(ports.scope, { lane: 'web' })('step', {
			source: 'context.dev',
			model: 'webhook',
			purpose: event.event ?? 'unknown',
			signed,
			data: event.data ?? null
		});
		return json({ received: event.event ?? null });
	}

	const trace = busTrace(ports.scope, { lane: 'web', change: event.data?.change?.id });
	const { recalls } = webClients(env, trace);
	const receivedAt = new Date().toISOString();
	trace('step', {
		source: 'context.dev',
		model: 'webhook',
		purpose: 'change.detected',
		detectedAt: event.data?.change?.detected_at,
		receivedAt
	});
	void handleChange(event, { ...ports, recalls, findings: findingsFor(env) })
		.then((rs) =>
			trace('done', {
				source: 'context.dev',
				purpose: 'recall ingest',
				notices: rs.length,
				anomalies: rs.reduce((n, r) => n + r.recorded.length, 0),
				msSinceWebhook: Date.now() - Date.parse(receivedAt)
			})
		)
		.catch((e) =>
			trace('error', {
				source: 'context.dev',
				purpose: 'recall ingest',
				error: String(e?.message ?? e)
			})
		);
	return json({ accepted: true, change: event.data?.change?.id ?? null, receivedAt }, 202);
};
