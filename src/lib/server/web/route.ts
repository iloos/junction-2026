/** Shared plumbing for the /api/web routes: bearer auth, JSON body, errors as `{error}` like the tool routes. */
import type { CallContext } from '$lib/core/ports';
import { resolveRequest, type Env } from '../auth';
import { json, unauthorized } from '../tools/http';
import { WebLimitError } from './spend';

export function authed(
	request: Request,
	env: Env,
	dev: boolean,
	via: string,
	allowed?: readonly string[]
): CallContext | Response {
	const ctx = resolveRequest(request, env, { dev, via });
	if (!ctx) return unauthorized();
	if (allowed && !allowed.includes(ctx.actor.kind))
		return fail('FORBIDDEN', `${ctx.actor.kind} may not call ${via}`, 403);
	return ctx;
}

export async function body<T = Record<string, unknown>>(request: Request): Promise<T | Response> {
	try {
		const text = await request.text();
		return (text ? JSON.parse(text) : {}) as T;
	} catch {
		return fail('INVALID_INPUT', 'body is not JSON', 400);
	}
}

export function fail(code: string, message: string, status: number, retryable = false): Response {
	return json({ error: { code, message, retryable } }, status);
}

/**
 * A cap or the provider's rate limit is 429 RATE_LIMITED with `Retry-After` (the UI waits, a click
 * doesn't become a 503); other provider errors are 503 PROVIDER_UNAVAILABLE (retryable); input errors 400.
 */
export function providerFail(e: unknown): Response {
	if (e instanceof WebLimitError) {
		return json(
			{
				error: {
					code: 'RATE_LIMITED',
					message: e.message,
					retryable: true,
					retryAfter: e.retryAfterS,
					reason: e.reason
				}
			},
			429,
			{ 'retry-after': String(e.retryAfterS) }
		);
	}
	const msg = e instanceof Error ? e.message : String(e);
	if (/^unknown product|^give a /.test(msg)) return fail('INVALID_INPUT', msg, 400);
	console.error('[web]', msg);
	return fail('PROVIDER_UNAVAILABLE', msg, 503, true);
}
