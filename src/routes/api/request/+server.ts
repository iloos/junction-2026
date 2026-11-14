import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { readAnswers, submitRequest, ToolFailed } from '$lib/server/request';
import { CORS, json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/**
 * Request → Lookup → Order for agents and tests: `POST {text, kitchenId?, nonce?, place?, answers?}` with a
 * bearer key. Runs as the key's actor (an `order` scope is needed to place; `place: false` needs
 * `read` only). Approve and commit go through /api/tools like every other caller.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest:request' });
	if (!ctx) return unauthorized();
	let body: {
		text?: unknown;
		kitchenId?: unknown;
		nonce?: unknown;
		place?: unknown;
		answers?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'body is not JSON', retryable: false } },
			400
		);
	}
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text || text.length > 500)
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'text: 1–500 characters', retryable: false } },
			400
		);
	try {
		const result = await submitRequest({
			text,
			kitchenId: typeof body.kitchenId === 'string' ? body.kitchenId : undefined,
			nonce: typeof body.nonce === 'string' ? body.nonce : undefined,
			place: body.place !== false,
			answers: readAnswers(body.answers),
			env,
			ctx
		});
		return json(result);
	} catch (e) {
		if (e instanceof ToolFailed)
			return json(
				{ error: { code: e.code, message: e.message, retryable: false } },
				e.code === 'FORBIDDEN' ? 403 : 422
			);
		return json(
			{
				error: {
					code: 'INVALID_INPUT',
					message: String((e as Error).message ?? e),
					retryable: false
				}
			},
			400
		);
	}
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
