import type { Approval, Order, Plan, Receipt } from '$lib/core/contracts';
import type { TaskLedger, TaskLedgerNeed, TaskPending } from '$lib/core/contracts/task';
import { nextActionFor } from '$lib/server/agent/next-action';
import { approvalUrl } from '$lib/server/tools/present';

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
	approvals: Pick<Approval, 'id' | 'planId' | 'planVersion' | 'state' | 'lineIds' | 'termsHash'>[];
	/** Scenario-clock now. */
	asOf: string;
}

/** A pending approval's lines grouped by the reasons they were held for: one decision per group. */
export function decisionGroups(
	plan: Plan,
	approval: Pick<Approval, 'lineIds'>
): { reason: string; lineIds: string[]; totalCents: number }[] {
	const groups = new Map<string, { reason: string; lineIds: string[]; totalCents: number }>();
	for (const id of approval.lineIds) {
		const line = plan.lines.find((l) => l.id === id);
		if (!line) continue;
		const reason = [...line.reasons].sort().join(', ') || 'needs approval';
		const g = groups.get(reason) ?? { reason, lineIds: [], totalCents: 0 };
		g.lineIds.push(id);
		g.totalCents += line.lineCents ?? 0;
		groups.set(reason, g);
	}
	return [...groups.values()];
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
	const primary = i.plans[0];
	const nextAction = primary
		? nextActionFor(primary, {
				approvalPending: pending.some((a) => a.planId === primary.id)
			}).text
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

/** Totals over a ledger's needs that share a unit, for one-line summaries ("4 kg planned, 0 supplier confirmed"). */
export function ledgerTotals(l: TaskLedger) {
	const sum = (k: keyof Omit<TaskLedgerNeed, 'needId' | 'planId' | 'label'>) =>
		l.needs.reduce((s, n) => s + n[k].value, 0);
	return {
		required: sum('required'),
		supplierConfirmed: sum('supplierConfirmed'),
		awaitingSupplier: sum('awaitingSupplier'),
		planned: sum('plannedKnown') + sum('plannedUnknown'),
		unresolved: sum('unresolved'),
		units: [...new Set(l.needs.map((n) => n.required.unit))]
	};
}
