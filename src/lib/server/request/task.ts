/**
 * A request's procurement task (D11): the durable objective every surface opens. /request creates one per placed
 * order or planned menu, through `ports.tasks` when the server has a TaskStore; without one, nothing is stored and
 * the result still links the plan in the Kitchen. Only the server writes a task; its ledger is left to the store's
 * owner, which recomputes it from get_plan and receipts.
 */
import { Task, type Plan, type Task as TaskT } from '$lib/core/contracts';
import type { CallContext, TaskStore } from '$lib/core/ports';

/** The Kitchen page focused on one plan (the deep link Ops uses). */
export function kitchenUrl(plan: Pick<Plan, 'kitchenId' | 'id' | 'version'>): string {
	const q = new URLSearchParams({
		kitchen: plan.kitchenId,
		plan: plan.id,
		v: String(plan.version)
	});
	return `/?${q}`;
}

export interface TaskSeed {
	tasks?: TaskStore;
	ctx: CallContext;
	now: Date;
	plan: Plan;
	title: string;
	/** The request as typed intent ("what"), never the transcript. */
	requirement: Record<string, unknown>;
	proposal?: { id: string; revision: number };
	/** A pending approval on the plan, when a human must decide. */
	approval?: {
		id: string;
		planVersion: number;
		termsHash: string;
		tier: string;
		lineIds: string[];
		totalCents: number;
	} | null;
}

export interface TaskLink {
	/** Null when the server has no task store yet. */
	taskId: string | null;
	kitchenUrl: string;
}

/** The task for this plan: created once (same plan, same task), then returned as stored. */
export async function taskForPlan(s: TaskSeed): Promise<TaskLink> {
	const link = { kitchenUrl: kitchenUrl(s.plan) };
	if (!s.tasks) return { taskId: null, ...link };
	const id = `t-${s.plan.id}`.slice(0, 64);
	const existing = await s.tasks.get(s.ctx.workspaceId, id);
	if (existing) return { taskId: existing.id, ...link };
	const at = s.now.toISOString();
	const pending: TaskT['pending'] = s.approval
		? {
				kind: 'decision',
				approvalId: s.approval.id,
				planId: s.plan.id,
				planVersion: s.approval.planVersion,
				termsHash: s.approval.termsHash,
				groups: [
					{
						reason: s.approval.tier,
						lineIds: s.approval.lineIds,
						totalCents: s.approval.totalCents
					}
				],
				approvalUrl: link.kitchenUrl
			}
		: { kind: 'none' };
	const task = Task.parse({
		workspaceId: s.ctx.workspaceId,
		runId: s.ctx.runId,
		id,
		kitchenId: s.plan.kitchenId,
		title: s.title.slice(0, 200),
		createdBy: s.ctx.actor,
		createdAt: at,
		updatedAt: at,
		version: 0,
		requirement: s.requirement,
		slots: {},
		plans: [{ planId: s.plan.id, versionSeen: s.plan.version, role: 'primary' }],
		...(s.proposal ? { proposal: s.proposal } : {}),
		runs: [],
		pending,
		state: s.approval ? 'awaiting_chef' : 'open'
	});
	const r = await s.tasks.put(task, null);
	// A concurrent submit created it first: that one is the task.
	return { taskId: r.ok ? r.value.id : id, ...link };
}
