import { json } from '@sveltejs/kit';
import { callTool } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/** The kitchen screen's allowlisted commands, served as the chef on this session's plan only. */
export const POST: RequestHandler = async (event) => {
	const { request, params, cookies } = event;
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const input = await request.json().catch(() => ({}));
	const r = await callTool(sid(cookies), workspaceId, params.name, input);
	return r.ok ? json(r.value) : json({ error: r.error }, { status: r.status });
};
