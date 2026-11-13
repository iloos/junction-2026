/** CORS for tool surfaces: auth is a bearer key, never a cookie, so `*` is safe (docs/foundations/mcp.md §1). */
export const CORS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
	'access-control-allow-headers':
		'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
	'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version, www-authenticate'
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...CORS, ...extra }
	});
}

export function unauthorized(): Response {
	return json(
		{ error: { code: 'FORBIDDEN', message: 'missing or unknown key', retryable: false } },
		401,
		{ 'www-authenticate': 'Bearer' }
	);
}

export function withCors(res: Response): Response {
	const h = new Headers(res.headers);
	for (const [k, v] of Object.entries(CORS)) h.set(k, v);
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
