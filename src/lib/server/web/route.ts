/** Shared plumbing for the /api/web routes: bearer auth, JSON body, errors as `{error}` like the tool routes. */
import type { Result, ToolScope } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { resolveRequest, type Env } from '../auth';
import { json, unauthorized } from '../tools/http';
import { HTTP_STATUS, isWebLimit, retryAfterOf } from '../tools/serve';
import { webError } from './spend';
import { log } from '$lib/server/obs/log';

/**
 * The caller of a web route from its key. Every route needs the `read` scope; a route that writes ops (recall
 * ingest, the replay drill) passes `scope: 'plan'` and the actor kinds it allows, like the tool gate.
 */
export function authed(
	request: Request,
	env: Env,
	dev: boolean,
	via: string,
	allowed?: readonly string[],
	scope: ToolScope = 'read'
): CallContext | Response {
	const ctx = resolveRequest(request, env, { dev, via });
	if (!ctx) return unauthorized();
	if (allowed && !allowed.includes(ctx.actor.kind))
		return fail('FORBIDDEN', `${ctx.actor.kind} may not call ${via}`, 403);
	return ctx.scopes.includes(scope)
		? ctx
		: fail('FORBIDDEN', `${via} needs the ${scope} scope`, 403);
}

/** Writes from a web route (recall ingest): only a chef or the system, with the plan scope. */
export function mayIngest(ctx: CallContext): Response | null {
	return ['chef', 'system'].includes(ctx.actor.kind) && ctx.scopes.includes('plan')
		? null
		: fail('FORBIDDEN', `${ctx.actor.kind} may read notices but not record them in a run`, 403);
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
 * A tool `Result` as the route's answer, with the same statuses as `/api/tools/<name>`: a daily cap or a
 * provider rate limit is 429 with `Retry-After` (the UI waits; repeated clicks never become a 503 storm).
 */
export function resultJson<T>(r: Result<T>): Response {
	if (r.ok) return json(r.value);
	const status = isWebLimit(r.error) ? 429 : HTTP_STATUS[r.error.code];
	if (status === 503) log.error('web.unavailable', { error: r.error.message });
	const wait = status === 429 ? retryAfterOf(r.error) : undefined;
	return json({ error: r.error }, status, wait ? { 'retry-after': String(wait) } : {});
}

/** A thrown provider or input error, answered like a tool error. */
export const providerFail = (e: unknown): Response => resultJson(webError(e));
