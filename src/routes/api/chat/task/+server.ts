import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { scenarioDate } from '$lib/core/scenario';
import { contextFor } from '$lib/server/auth';
import { taskView } from '$lib/server/chat/turn';
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
 * from its plans now. The dock calls it when it opens on a remembered task. Visitor cookie, own workspace only.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.url.searchParams.get('id') ?? '';
	if (!isTaskId(id))
		return json({ error: { code: 'INVALID_INPUT', message: 'id', retryable: false } }, 400);
	const v = await visitorWorkspace(event, env, dev);
	const ctx = await onCurrentRun(contextFor('chef', 'chef', 'chat', env, v.workspaceId));
	const handlers = scopedHandlers;
	const [b, tasks] = await Promise.all([createServerPorts(), serverTasks()]);
	const events = await withCallScope(ctx, () =>
		taskView(id, {
			handlers,
			ctx,
			ports: { ...b.ports, tasks },
			workspaceId: v.workspaceId,
			kitchen: { id: 'k-hotel' },
			today: scenarioDate(b.ports.clock.now())
		})
	);
	return json({ events });
};
