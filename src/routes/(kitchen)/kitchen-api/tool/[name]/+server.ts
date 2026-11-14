import { json } from '@sveltejs/kit';
import { callTool } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import type { RequestHandler } from './$types';

/** The kitchen screen's allowlisted commands, served as the chef on this session's plan only. */
export const POST: RequestHandler = async ({ request, params, cookies }) => {
	const input = await request.json().catch(() => ({}));
	const r = await callTool(sid(cookies), params.name, input);
	return r.ok ? json(r.value) : json({ error: r.error }, { status: r.status });
};
