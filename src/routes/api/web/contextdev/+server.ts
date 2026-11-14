import { env } from '$env/dynamic/private';
import { stateWrites } from '$lib/server/web/persist';
import { json } from '$lib/server/tools/http';
import {
	sameSecret,
	verifyContextSignature,
	type ChangeDetected
} from '$lib/server/web/contextdev';
import {
	applicationsFor,
	findingsFor,
	queueFor,
	recallTargets,
	webPg,
	webStateReady,
	scopeOf,
	webClients
} from '$lib/server/web';
import { fail } from '$lib/server/web/route';
import { busTrace, drain, enqueueChange } from '$lib/server/web/watch';
import type { RequestHandler } from './$types';

/**
 * POST /api/web/contextdev: Context.dev monitor webhook. Accepted when `X-Context-Signature` verifies
 * against CONTEXT_DEV_WEBHOOK_SECRET (Context.dev deliveries) or `x-mandate-webhook-secret` equals it
 * (our scripts).
 * - `change.detected`: the change is written to the recall work queue on disk, then answered 202; the
 *   notices are read and recorded in the background and the anomalies arrive on the op stream. A read
 *   that fails stays queued.
 * - `run.completed`: works the queue and re-reads the list (at most hourly), so a failed read heals on
 *   the monitor's next run and edited notices are re-read and diffed.
 * Notices are applied to every `WEB_RECALL_WORKSPACES` target's current run; a reset run is caught up
 * from the stored reads without another paid call.
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
	const queue = queueFor(env);
	const isChange = event.event === 'change.detected';
	// Recorded before any await that can fail (the memory map, written through to Postgres): a 202 never
	// loses the change.
	const queued = isChange ? enqueueChange(event, queue) : [];
	await webStateReady(env);
	await stateWrites();
	const receivedAt = new Date().toISOString();

	let targets: Awaited<ReturnType<typeof recallTargets>>;
	try {
		targets = await recallTargets(env);
	} catch (e) {
		console.error('[web] webhook: store unavailable', e);
		// Queued work waits for the next delivery; a run.completed without work is simply skipped.
		return isChange
			? json({ accepted: true, queued, receivedAt, deferred: true }, 202)
			: json({ received: event.event ?? null, deferred: true });
	}
	const findings = findingsFor(env);
	const applications = applicationsFor(env);
	const pg = webPg();
	const owner = `${process.pid}:${receivedAt}`;
	void (async () => {
		// The notices are read once (first target); every target then gets them applied from the read.
		for (const [i, w] of targets.entries()) {
			const scope = scopeOf(w);
			const trace = busTrace(scope, {
				lane: 'web',
				...(isChange ? { change: event.data?.change?.id } : {})
			});
			if (i === 0)
				trace('step', {
					source: 'context.dev',
					model: 'webhook',
					purpose: event.event ?? 'unknown',
					signed,
					...(isChange
						? { detectedAt: event.data?.change?.detected_at, receivedAt, queued }
						: { data: event.data ?? null })
				});
			try {
				const r = await drain({
					store: w.ports.store,
					index: w.index,
					scope,
					findings,
					applications,
					queue,
					recalls: webClients(env, trace, w.spendKey).recalls,
					...(pg
						? { claim: () => pg.claimQueue(owner, 10), release: () => pg.releaseQueue(owner) }
						: {}),
					heal: !isChange && i === 0
				});
				trace(r.failed.length || r.listError ? 'error' : 'done', {
					source: 'context.dev',
					purpose: isChange ? 'recall ingest' : 'recall heal',
					notices: r.results.length,
					anomalies: [...r.results, ...r.applied].reduce((n, x) => n + x.recorded.length, 0),
					updates: r.results.filter((x) => x.update).length,
					appliedFromStore: r.applied.length,
					failed: r.failed,
					...(r.listError ? { listError: r.listError } : {}),
					stillQueued: r.queued,
					msSinceWebhook: Date.now() - Date.parse(receivedAt)
				});
			} catch (e) {
				trace('error', {
					source: 'context.dev',
					purpose: 'recall ingest',
					error: String((e as Error)?.message ?? e)
				});
			}
		}
	})();
	return isChange
		? json({ accepted: true, change: event.data?.change?.id ?? null, queued, receivedAt }, 202)
		: json({ received: event.event ?? null });
};
