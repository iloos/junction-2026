import type { Approval, Order, Plan, Receipt } from '$lib/core/contracts';
import type { TaskLedger, TaskLedgerNeed, TaskPending } from '$lib/core/contracts/task';
import { nextActionFor } from '$lib/server/agent/next-action';
import { approvalUrl } from '$lib/server/tools/present';
import { decisionsOf } from '$lib/ui/decisions';

/**
 * The task ledger: what is true for a task's plans now, in numbers. Pure: computed from the plans as get_plan returns
 * them (with their FulfilmentView), the orders and receipts written for those plans, and the live approvals. Nothing
 * here is model-written; every claim a chat line or summary makes must be backed by a field of it.
 */
export interface LedgerInput {
	/** The task's plans, primary first, each with its read model (`view`) as get_plan returns it. */
	plans: Plan[];
	orders: Order[];
	receipts: Receipt[];
	/** Live approvals of those plans (any state); pending ones are decisions left. */
	approvals: Approval[];
	/** Scenario-clock now. */
	asOf: string;
}

/** A pending approval's decisions as the task records them: the Kitchen page's own grouping (decisionsOf). */
export function decisionGroups(
	plan: Plan,
	approval: Approval
): { reason: string; lineIds: string[]; totalCents: number }[] {
	return decisionsOf(plan, approval).map((d) => ({
		reason: d.reason,
		lineIds: d.lineIds,
		totalCents: d.totalCents
	}));
}

/** The task's pending decision on its primary plan, or none: locates the Kitchen approval panel, never authorises. */
export function pendingDecision(
	plan: Plan | undefined,
	approvals: LedgerInput['approvals']
): TaskPending {
	const a = plan && approvals.find((x) => x.planId === plan.id && x.state === 'pending');
	if (!plan || !a) return { kind: 'none' };
	return {
		kind: 'decision',
		approvalId: a.id,
		planId: plan.id,
		planVersion: a.planVersion,
		termsHash: a.termsHash,
		groups: decisionGroups(plan, a),
		approvalUrl: approvalUrl(plan)
	};
}

export function computeLedger(i: LedgerInput): TaskLedger {
	const planIds = new Set(i.plans.map((p) => p.id));
	const orders = i.orders.filter((o) => planIds.has(o.planId));
	const orderIds = new Set(orders.map((o) => o.id));
	const receipts = i.receipts.filter((r) => orderIds.has(r.orderId));
	const needs: TaskLedgerNeed[] = i.plans.flatMap((p) =>
		(p.view?.fulfilment ?? []).map((f) => ({
			needId: f.needId,
			planId: p.id,
			label: f.label,
			required: f.required,
			supplierConfirmed: f.supplierConfirmed,
			awaitingSupplier: f.awaitingSupplier,
			plannedKnown: f.plannedKnown,
			plannedUnknown: f.plannedUnknown,
			unresolved: f.unresolved,
			excess: f.excess
		}))
	);
	const pending = i.approvals.filter((a) => planIds.has(a.planId) && a.state === 'pending');
	const decisionsLeft = pending.reduce((n, a) => {
		const plan = i.plans.find((p) => p.id === a.planId)!;
		return n + Math.max(1, decisionGroups(plan, a).length);
	}, 0);
	// The next action of the first plan that still has one: a finished plan never speaks for an open one.
	const nexts = i.plans.map((p) =>
		nextActionFor(p, { approvalPending: pending.some((a) => a.planId === p.id) })
	);
	const nextAction = nexts.length
		? (nexts.find((n) => n.kind !== 'done') ?? nexts[0]).text
		: 'Nothing is planned yet.';
	const validUntil = i.plans
		.map((p) => p.view?.validUntil)
		.filter((x): x is string => !!x)
		.sort()[0];
	return {
		asOf: i.asOf,
		...(validUntil ? { validUntil } : {}),
		needs,
		committedCents: orders.reduce((s, o) => s + o.totalCents, 0),
		receiptIds: receipts.map((r) => r.id),
		decisionsLeft,
		nextAction: nextAction.slice(0, 200)
	};
}

/** Totals over a ledger's needs per unit (kg and l never add up), for one-line summaries and the claim check. */
export function ledgerTotals(l: TaskLedger): Record<
	string,
	{
		required: number;
		supplierConfirmed: number;
		awaitingSupplier: number;
		planned: number;
		unresolved: number;
	}
> {
	const out: ReturnType<typeof ledgerTotals> = {};
	for (const n of l.needs) {
		const t = (out[n.required.unit] ??= {
			required: 0,
			supplierConfirmed: 0,
			awaitingSupplier: 0,
			planned: 0,
			unresolved: 0
		});
		t.required += n.required.value;
		t.supplierConfirmed += n.supplierConfirmed.value;
		t.awaitingSupplier += n.awaitingSupplier.value;
		t.planned += n.plannedKnown.value + n.plannedUnknown.value;
		t.unresolved += n.unresolved.value;
	}
	return out;
}
