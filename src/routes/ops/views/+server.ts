import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { PlanView } from '$lib/core/contracts';
import { liveApprovals } from '$lib/core/services/orders';
import { withPlanView } from '$lib/core/services/views';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { isMemoryOnly } from '$lib/server/bus';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { mayRead } from '$lib/server/demo/visitor';
import { createServerPorts } from '$lib/server/store/server-ports';
import { realHandlers } from '$lib/server/tools/handlers';
import type { RequestHandler } from './$types';

/**
 * GET /ops/views?ws=<workspace> → `{ runId, views: { [planId]: PlanView }, names: { [productId]: name } }`: the read model the op stream doesn't
 * carry (views are computed at read time against the clock, never stored). /ops takes coverage from
 * `view.fulfilment`, the same definition get_plan and the kitchen use. Read-only; the same readers as /api/events.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const workspaceId = url.searchParams.get('ws') ?? '';
	if (!workspaceId || (!dev && !mayRead(workspaceId, cookies, env)))
		return json({ error: { code: 'FORBIDDEN', message: 'unknown workspace' } }, { status: 403 });
	if (isMemoryOnly(workspaceId)) return json({ runId: null, views: {} });
	const runId = await ensureRunLoaded(workspaceId);
	await realHandlers();
	const { ports } = await createServerPorts();
	const { views, names } = await inWorkspace(workspaceId, async () => {
		const state = await ports.store.load(workspaceId, runId);
		const out: Record<string, PlanView> = {};
		const ids = new Set<string>();
		for (const plan of Object.values(state.plans)) {
			const withView = await withPlanView(ports, plan, state, liveApprovals(state, plan.id));
			if (withView.view) out[plan.id] = withView.view;
			for (const l of plan.lines) {
				ids.add(l.productId);
				if (l.substituteFor) ids.add(l.substituteFor);
			}
		}
		for (const a of Object.values(state.anomalies)) if (a.productId) ids.add(a.productId);
		// Every product the plans name, from the catalogue: /ops never shows "Product <id>" for a real one.
		const byId = await ports.catalog.get([...ids]).catch(() => new Map());
		const names: Record<string, string> = {};
		for (const [id, p] of byId) names[id] = p.nameEn || p.nameFi;
		return { views: out, names };
	});
	return json({ runId, views, names }, { headers: { 'cache-control': 'no-store' } });
};
