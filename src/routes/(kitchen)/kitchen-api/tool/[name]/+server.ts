import { json } from '@sveltejs/kit';
import { callTool } from '$lib/server/kitchen/live';
import type { RequestHandler } from './$types';

/** The kitchen screen's tool calls, served as the chef server-side (the browser holds no key). */
export const POST: RequestHandler = async ({ request, params }) => {
	const input = await request.json().catch(() => ({}));
	const r = await callTool(params.name, input);
	return r.ok ? json(r.value) : json({ error: r.error }, { status: r.status });
};
