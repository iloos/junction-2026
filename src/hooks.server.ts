import { requestIdFrom, withRequest, type RequestContext } from '$lib/server/obs/context';
import { errMsg, log } from '$lib/server/obs/log';
import type { Handle } from '@sveltejs/kit';

/**
 * Request body limits. adapter-node allows 8 MB (BODY_SIZE_LIMIT in the Dockerfile) so a phone photo reaches
 * read_image; every other route takes at most SMALL_BODY. A declared Content-Length over the route's limit is
 * refused here before anything reads it; a body without one is still capped at 8 MB by the adapter.
 */
export const SMALL_BODY = 256 * 1024;
export const IMAGE_BODY = 8 * 1024 * 1024;

/** Routes that take an image (or carry one through MCP): /api/tools/read_image, kitchen image routes, /mcp. */
export function bodyLimit(pathname: string): number {
	if (pathname === '/api/tools/read_image') return IMAGE_BODY;
	if (pathname.startsWith('/kitchen-api/') && pathname.includes('image')) return IMAGE_BODY;
	if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return IMAGE_BODY;
	return SMALL_BODY;
}

/** Asset and probe paths get a request id but no request log lines. */
const QUIET = /^\/(_app\/|favicon|robots\.txt|healthz$)/;

/**
 * Every request runs inside its request context (obs/context.ts): an id (the caller's x-request-id when it is
 * plain, else a new one) that log lines, stored traces and tool calls pick up, returned as `x-request-id`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const requestId = requestIdFrom(event.request.headers.get('x-request-id'));
	const path = event.url.pathname;
	const ctx: RequestContext = {
		requestId,
		method: event.request.method,
		route: event.route.id ?? path
	};
	const quiet = QUIET.test(path);
	const t0 = performance.now();
	return withRequest(ctx, async () => {
		if (!quiet) log.info('request.in', { method: ctx.method, route: ctx.route });
		let res: Response;
		try {
			res = await guarded({ event, resolve });
		} catch (e) {
			log.error('request.error', {
				method: ctx.method,
				route: ctx.route,
				ms: Math.round(performance.now() - t0),
				error: errMsg(e)
			});
			throw e;
		}
		try {
			res.headers.set('x-request-id', requestId);
		} catch {
			// An immutable response (a fetched one passed through) keeps its own headers.
		}
		if (!quiet) {
			const fields = {
				method: ctx.method,
				route: ctx.route,
				status: res.status,
				ms: Math.round(performance.now() - t0)
			};
			if (res.status >= 500) log.error('request.out', fields);
			else if (res.status >= 400) log.warn('request.out', fields);
			else log.info('request.out', fields);
		}
		return res;
	});
};

const guarded: Handle = async ({ event, resolve }) => {
	const length = Number(event.request.headers.get('content-length') ?? 0);
	if (length > 0) {
		const limit = bodyLimit(event.url.pathname);
		if (length > limit)
			return new Response(
				JSON.stringify({
					error: {
						code: 'INVALID_INPUT',
						message: `Request body is ${length} bytes; this route takes at most ${limit}.`,
						retryable: false
					}
				}),
				{ status: 413, headers: { 'content-type': 'application/json' } }
			);
	}
	return resolve(event);
};
