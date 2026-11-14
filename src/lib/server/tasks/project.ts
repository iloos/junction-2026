import type { Approval, Plan } from '$lib/core/contracts';
import type { Task, TaskLedger, TaskState } from '$lib/core/contracts/task';
import type { CallContext, Ports, TaskStore, ToolHandlers } from '$lib/core/ports';
import { nextFor } from '$lib/server/agent/next';
import { pendingDecision } from './ledger';
import { readTask } from './outcome';

/**
 * A task's derived fields (ledger, pending decision, state) from every plan it holds, as they are now. A human acting
 * on another screen (approving, editing) changes a plan, not the task row, so these are recomputed whenever a task is
 * read or written; only the requirement, slots, an open question and the run history are stored facts. No plan's
 * state hides another's: the task is done only when every plan is, it awaits the chef while any plan has a pending
 * decision, and Continue is offered while any plan has a line that may be bought now.
 */
export function project(
	task: Task,
	read: { ledger: TaskLedger; plans: Plan[]; approvals: Approval[] }
): { task: Task; canContinue: boolean } {
	const { ledger, plans, approvals } = read;
	const t: Task = {
		...task,
		plans: task.plans.map((p) => ({
			...p,
			versionSeen: plans.find((x) => x.id === p.planId)?.version ?? p.versionSeen
		})),
		ledger
	};
	if (t.pending.kind === 'clarify') return { task: t, canContinue: false };
	// The first plan (task order) with a pending decision is the one the card shows.
	const decision = plans
		.map((p) => pendingDecision(p, approvals))
		.find((d) => d.kind === 'decision');
	t.pending = decision ?? { kind: 'none' };
	const nexts = plans.map((p) => nextFor(p));
	const canContinue = plans.some((p) =>
		p.lines.some((l) => l.state !== 'committed' && l.view?.committable === true)
	);
	const state: TaskState =
		t.pending.kind === 'decision' || nexts.some((n) => n.action === 'approve')
			? 'awaiting_chef'
			: canContinue || nexts.some((n) => n.action !== 'done' && n.action !== 'wait_for_supplier')
				? 'open'
				: nexts.some((n) => n.action === 'wait_for_supplier')
					? 'awaiting_supplier'
					: plans.length && ledger.receiptIds.length
						? 'done'
						: 'open';
	if (!['cancelled', 'failed'].includes(t.state)) t.state = state;
	return { task: t, canContinue };
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
		// The list projects the same way, then filters on the projected state, so a list and a detail never disagree.
		list: async (ws, o = {}) => {
			const rows = await inner.list(ws, { ...o, open: undefined });
			const done = new Set(['done', 'cancelled', 'failed']);
			const out: Task[] = [];
			for (const t of rows) {
				const f = (await fresh(t))!;
				if (o.open === undefined || o.open !== done.has(f.state)) out.push(f);
			}
			return out;
		},
		put: (task, expected) => inner.put(task, expected)
	};
}
