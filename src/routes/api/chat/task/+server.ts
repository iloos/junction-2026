import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { scenarioDate } from '$lib/core/scenario';
import { contextFor } from '$lib/server/auth';
import { planView, taskView } from '$lib/server/chat/turn';
import { onCurrentRun } from '$lib/server/demo/reset';
import { withCallScope } from '$lib/server/scope';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { createServerPorts } from '$lib/server/store/server-ports';
import { serverTasks } from '$lib/server/tasks/server';
import { handlers as scopedHandlers } from '$lib/server/tools/handlers';
import { isTaskId } from '$lib/core/contracts/task';
import { json } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/**
 * GET /api/chat/task?id=<taskId>: the task's current cards (clarify | decision, ledger, done) as ChatEvents, read
 * from its plans now. The dock calls it when it opens on a remembered task. GET /api/chat/task?planId=<planId>: the
 * task holding the page's plan, if any ({taskId, title, events}), for a dock opened on that plan. Visitor cookie,
 * own workspace only.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.url.searchParams.get('id') ?? '';
	const planId = event.url.searchParams.get('planId') ?? '';
	if (planId && !/^[\w:.-]{1,128}$/.test(planId))
		return json({ error: { code: 'INVALID_INPUT', message: 'planId', retryable: false } }, 400);
	if (!planId && !isTaskId(id))
		return json({ error: { code: 'INVALID_INPUT', message: 'id', retryable: false } }, 400);
	const v = await visitorWorkspace(event, env, dev);
	const ctx = await onCurrentRun(contextFor('chef', 'chef', 'chat', env, v.workspaceId));
	const handlers = scopedHandlers;
	const [b, tasks] = await Promise.all([createServerPorts(), serverTasks()]);
	const deps = {
		handlers,
		ctx,
		ports: { ...b.ports, tasks },
		workspaceId: v.workspaceId,
		kitchen: { id: 'k-hotel' },
		today: scenarioDate(b.ports.clock.now())
	};
	if (planId) return json(await withCallScope(ctx, () => planView(planId, deps)));
	const events = await withCallScope(ctx, () => taskView(id, deps));
	return json({ events });
};
