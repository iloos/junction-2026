import type { Approval, Plan } from '$lib/core/contracts';
import type { Task, TaskLedger, TaskState } from '$lib/core/contracts/task';
import type { CallContext, Ports, TaskStore, ToolHandlers } from '$lib/core/ports';
import { nextActionFor } from '$lib/server/agent/next-action';
import { pendingDecision } from './ledger';
import { readTask } from './outcome';

/**
 * A task's derived fields (ledger, pending decision, state) from its plans as they are now. A human acting on another
 * screen (approving, editing) changes the plan, not the task row, so these are recomputed whenever a task is read or
 * written; only the requirement, slots, an open question and the run history are stored facts.
 */
export function project(
	task: Task,
	read: { ledger: TaskLedger; plans: Plan[]; approvals: Approval[] }
): { task: Task; canContinue: boolean } {
	const { ledger, plans, approvals } = read;
	const plan = plans[0];
	const t: Task = {
		...task,
		plans: task.plans.map((p) => ({
			...p,
			versionSeen: plans.find((x) => x.id === p.planId)?.version ?? p.versionSeen
		})),
		ledger
	};
	if (t.pending.kind === 'clarify') return { task: t, canContinue: false };
	t.pending = pendingDecision(plan, approvals);
	const next = nextActionFor(plan, { approvalPending: t.pending.kind === 'decision' });
	const granted = approvals.some(
		(a) =>
			a.state === 'granted' &&
			a.planVersion === plan.version &&
			a.lineIds.some((id) => plan.lines.find((l) => l.id === id)?.state !== 'committed')
	);
	const state: TaskState =
		t.pending.kind === 'decision'
			? 'awaiting_chef'
			: next.kind === 'await_supplier'
				? 'awaiting_supplier'
				: next.kind === 'done' && ledger.receiptIds.length
					? 'done'
					: 'open';
	if (!['cancelled', 'failed'].includes(t.state)) t.state = state;
	return { task: t, canContinue: next.kind === 'commit' || granted };
}

/**
 * A TaskStore whose reads come back with the derived fields recomputed from the plans (read scope, the task's own
 * workspace and run). Writes pass through unchanged.
 */
export function projectedTaskStore(
	inner: TaskStore,
	ports: Pick<Ports, 'store' | 'clock'>,
	handlers: Pick<ToolHandlers, 'get_plan'>
): TaskStore {
	const fresh = async (t: Task | null): Promise<Task | null> => {
		if (!t || !t.plans.length) return t;
		const ctx: CallContext = {
			workspaceId: t.workspaceId,
			runId: t.runId,
			actor: { kind: 'system', id: 'task-view' },
			scopes: ['read'],
			via: 'task'
		};
		const r = await readTask(
			ctx,
			ports,
			handlers,
			t.plans.map((p) => p.planId)
		);
		return r.ok ? project(t, r.value).task : t;
	};
	return {
		get: async (ws, id) => fresh(await inner.get(ws, id)),
		list: (ws, o) => inner.list(ws, o),
		put: (task, expected) => inner.put(task, expected)
	};
}
