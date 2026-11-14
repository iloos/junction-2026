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

export const handle: Handle = async ({ event, resolve }) => {
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
