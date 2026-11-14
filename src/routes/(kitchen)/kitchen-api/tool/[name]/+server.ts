import { json } from '@sveltejs/kit';
import { callTool, type RenderedView } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import type { RequestHandler } from './$types';

/** `x-kitchen-view: {"runId","planId","version"}`: what the page was rendered from. */
function renderedView(header: string | null): RenderedView | null {
	if (!header) return null;
	try {
		const v = JSON.parse(header) as Partial<RenderedView>;
		return typeof v.runId === 'string' &&
			typeof v.planId === 'string' &&
			typeof v.version === 'number'
			? { runId: v.runId, planId: v.planId, version: v.version }
			: null;
	} catch {
		return null;
	}
}

/** The kitchen screen's allowlisted commands, served as the chef on this session's plan only. */
export const POST: RequestHandler = async (event) => {
	const { request, params, cookies } = event;
	const { workspaceId } = await visitorWorkspace(event, env, dev);
	const input = await request.json().catch(() => ({}));
	const view = renderedView(request.headers.get('x-kitchen-view'));
	const r = await callTool(sid(cookies), workspaceId, params.name, input, view);
	return r.ok ? json(r.value) : json({ error: r.error }, { status: r.status });
};
