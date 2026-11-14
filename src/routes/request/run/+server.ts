import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	approveRequest,
	commitRequest,
	readAnswers,
	readBriefAnswers,
	submitRequest,
	ToolFailed
} from '$lib/server/request';
import { readRankBy } from '$lib/server/request/rank-by';
import { readDish, readItems } from '$lib/server/request/workspace';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { visitorKey } from '$lib/server/kitchen/live';
import type { RequestHandler } from './$types';

/**
 * The /request page's server side. `request` streams one NDJSON line per finished step, then the
 * result; `approve` and `commit` answer with JSON. The page never holds a key: the actors are
 * server-side contexts (kitchen agent places, head chef approves, chef commits), in the workspace
 * the browser's room (server/demo/visitor.ts): its own sandbox, or the stage for a presenter.
 */
export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
	const { workspaceId, own } = await visitorWorkspace(event, env, dev);
	// Writes to a kitchen this browser owns carry its visitor (D24).
	const visitor = visitorKey(own);
	const int = (k: string) => (Number.isInteger(body[k]) ? (body[k] as number) : -1);

	try {
		if (body.action === 'approve')
			return json(
				await approveRequest({
					env,
					workspaceId,
					visitor,
					approvalId: str('approvalId'),
					planId: str('planId'),
					planVersion: int('planVersion'),
					termsHash: str('termsHash'),
					decision: body.decision === 'deny' ? 'deny' : 'grant'
				})
			);
		if (body.action === 'commit')
			return json(
				await commitRequest({
					env,
					workspaceId,
					visitor,
					planId: str('planId'),
					version: int('version'),
					attempt: Math.max(1, int('attempt')),
					lineIds: Array.isArray(body.lineIds)
						? (body.lineIds as unknown[])
								.filter((x): x is string => typeof x === 'string' && /^[\w.:~-]{1,80}$/.test(x))
								.slice(0, 50)
						: undefined
				})
			);
	} catch (e) {
		const code = e instanceof ToolFailed ? e.code : 'INTERNAL';
		return json(
			{ error: { code, message: e instanceof Error ? e.message : String(e) } },
			{ status: 422 }
		);
	}

	const text = str('text').trim();
	if (!text || text.length > 500)
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'Type a request (up to 500 characters).' } },
			{ status: 400 }
		);

	const enc = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
			try {
				const result = await submitRequest({
					text,
					kitchenId: str('kitchenId') || undefined,
					nonce: str('nonce') || undefined,
					answers: readAnswers(body.answers),
					briefAnswers: readBriefAnswers(body.briefAnswers),
					confirmLarge: body.confirmLarge === true,
					deliverBy: /^\d{4}-\d{2}-\d{2}$/.test(str('deliverBy')) ? str('deliverBy') : undefined,
					rankBy: readRankBy(body.rankBy),
					dish: readDish(body.dish),
					items: readItems(body.items),
					workspaceId,
					visitor,
					env,
					onEvent: send
				});
				send({ step: 'result', data: result });
			} catch (e) {
				send({
					step: 'error',
					status: 'error',
					ms: 0,
					message: e instanceof Error ? e.message : String(e)
				});
			}
			controller.close();
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
	});
};
