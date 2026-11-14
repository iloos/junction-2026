import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { handlers } from '$lib/server/tools/handlers';
import { CORS, json, unauthorized } from '$lib/server/tools/http';
import { retryAfterOf, serveTool } from '$lib/server/tools/serve';
import type { RequestHandler } from './$types';

/** REST mirror of the tool registry: same gate as MCP. Body = tool input; 200 = tool output; else {error}. */
export const POST: RequestHandler = async ({ request, params }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	let body: unknown;
	try {
		const text = await request.text();
		body = text ? JSON.parse(text) : {};
	} catch {
		return json(
			{ error: { code: 'INVALID_INPUT', message: 'body is not JSON', retryable: false } },
			400
		);
	}
	const r = await serveTool(params.name, ctx, body, handlers);
	if (r.ok) return json(r.value);
	const wait = r.status === 429 ? retryAfterOf(r.error) : undefined;
	return json({ error: r.error }, r.status, wait ? { 'retry-after': String(wait) } : {});
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
