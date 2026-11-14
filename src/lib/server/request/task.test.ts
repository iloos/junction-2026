import { describe, expect, it } from 'vitest';
import { ok, SCOPES_BY_ACTOR, type Task } from '$lib/core/contracts';
import type { CallContext, TaskStore } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { runRequest } from './run';

/** A TaskStore stand-in until the agent lane's adapter lands: compare-and-set on version. */
function memoryTasks(): TaskStore & { all: Task[] } {
	const all: Task[] = [];
	return {
		all,
		async get(ws, id) {
			return all.find((t) => t.workspaceId === ws && t.id === id) ?? null;
		},
		async list(ws) {
			return all.filter((t) => t.workspaceId === ws);
		},
		async put(task, expected) {
			const i = all.findIndex((t) => t.workspaceId === task.workspaceId && t.id === task.id);
			if (expected === null && i < 0) all.push(task);
			else if (i >= 0 && all[i].version === expected) all[i] = task;
			else throw new Error('version');
			return ok(task);
		}
	};
}

describe('a request creates its procurement task', () => {
	it('stores one task per placed order, waiting on the chef, and links the plan in the Kitchen', async () => {
		const env = await createDbPorts();
		env.overlay.clear();
		const h = createHandlers(env.ports);
		const ctx: CallContext = {
			workspaceId: env.workspaceId,
			runId: env.runId,
			actor: { kind: 'kitchen_agent', id: 'a' },
			scopes: SCOPES_BY_ACTOR.kitchen_agent,
			via: 'test'
		};
		const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		const tasks = memoryTasks();
		const deps = {
			handlers: h,
			ctx,
			today: '2026-12-07',
			kitchen,
			nonce: 'task',
			tasks,
			now: new Date('2026-12-07T21:40:00+02:00')
		};
		const r = await runRequest('1,000 L lactose-free milk by Thursday', deps);
		expect(r.message).toBe('This order is now in your Kitchen plan.');
		const link = r.order!.task;
		expect(link.kitchenUrl).toBe(
			`/?kitchen=k-hotel&plan=${encodeURIComponent(r.order!.plan.id)}&v=${r.order!.plan.version}`
		);
		expect(link.taskId).toBe(`t-${r.order!.plan.id}`.slice(0, 64));
		expect(tasks.all).toHaveLength(1);
		const t = tasks.all[0];
		expect(t.state).toBe('awaiting_chef');
		expect(t.pending.kind).toBe('decision');
		expect(t.plans).toEqual([
			{ planId: r.order!.plan.id, versionSeen: r.order!.plan.version, role: 'primary' }
		]);
		// The same words and nonce replay the plan: still one task.
		await runRequest('1,000 L lactose-free milk by Thursday', deps);
		expect(tasks.all).toHaveLength(1);

		// Without a task store the link is still there.
		const none = await runRequest('20 kg potatoes Friday', { ...deps, tasks: undefined });
		expect(none.order?.task.taskId ?? null).toBeNull();
		expect(none.order?.task.kitchenUrl).toMatch(/^\/\?kitchen=k-hotel&plan=/);
	});
});
