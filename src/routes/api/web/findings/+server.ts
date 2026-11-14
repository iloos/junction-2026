import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json } from '$lib/server/tools/http';
import { applicationsFor, findingsFor, queueFor, webMode } from '$lib/server/web';
import type { Finding } from '$lib/server/web/findings';
import { authed } from '$lib/server/web/route';
import type { RequestHandler } from './$types';

/**
 * GET /api/web/findings?kind=recall|facts|outside (any key): what the web lane found, newest first: the
 * public recall notices plus the caller's workspace's own findings, where each notice was applied in
 * this workspace, and recall work still queued.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const ctx = authed(request, env, dev, 'web:findings');
	if (ctx instanceof Response) return ctx;
	const kind = url.searchParams.get('kind') as Finding['kind'] | null;
	return json({
		mode: webMode(env),
		workspaceId: ctx.workspaceId,
		findings: findingsFor(env).list(kind ?? undefined, ctx.workspaceId),
		applications: applicationsFor(env).list(ctx.workspaceId),
		queued: queueFor(env).all()
	});
};
