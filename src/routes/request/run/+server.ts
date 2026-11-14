import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	approveRequest,
	commitRequest,
	pageWorkspace,
	readAnswers,
	readBriefAnswers,
	submitRequest,
	ToolFailed
} from '$lib/server/request';
import type { RequestHandler } from './$types';

/**
 * The /request page's server side. `request` streams one NDJSON line per finished step, then the
 * result; `approve` and `commit` answer with JSON. The page never holds a key: the actors are
 * server-side contexts (kitchen agent places, head chef approves, chef commits), in the workspace
 * pageWorkspace() decides: the judges' sandbox unless presenter actions are open.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
	const workspaceId = pageWorkspace(env, dev).id;
	const int = (k: string) => (Number.isInteger(body[k]) ? (body[k] as number) : -1);

	try {
		if (body.action === 'approve')
			return json(
				await approveRequest({
					env,
					workspaceId,
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
					planId: str('planId'),
					version: int('version'),
					attempt: Math.max(1, int('attempt'))
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
					workspaceId,
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
