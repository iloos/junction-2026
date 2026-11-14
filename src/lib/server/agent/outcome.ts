import type { Plan, ToolOutput } from '$lib/core/contracts';
import { nextFor } from './next';
import type { Clarify, GoalOutcome, IntentKind, NeedRef } from './types';

type Approval = ToolOutput<'get_plan'>['approval'];

/** Lines that can still supply something: not out of the running. */
const ACTIVE = new Set(['proposed', 'eligible', 'held', 'committed']);

/**
 * GoalOutcome from domain state. With the plan's FulfilmentView, each need is supplier confirmed only when
 * receipt-backed, unresolved when any required quantity has no line, and otherwise covered but unconfirmed
 * (planned, held, or ordered and awaiting the supplier). A plan without a view falls back to line states.
 * Status: unresolved needs → partial (blocked if nothing else is covered); a pending approval or held line
 * → awaiting_user; every need supplier confirmed → fulfilled; otherwise partial.
 * `inspect` is fulfilled once the plan was read: it asks a question, not for supply.
 */
export function computeOutcome(o: {
	intent: IntentKind;
	plan: Plan | null;
	approval: Approval;
	/** Why there is no plan, or why the run stopped early (kept in `reason`). */
	reason?: string;
}): GoalOutcome {
	const base = {
		intent: o.intent,
		planId: o.plan?.id ?? null,
		planVersion: o.plan?.version ?? null,
		confirmedNeeds: [] as NeedRef[],
		unconfirmedNeeds: [] as NeedRef[],
		unresolvedNeeds: [] as NeedRef[],
		approvalIds: [] as string[],
		...(o.reason ? { reason: o.reason } : {})
	};
	if (!o.plan)
		return {
			...base,
			status: 'blocked',
			nextAction: o.reason ? `Nothing was planned: ${o.reason}` : 'Nothing was planned; try again.'
		};

	const plan = o.plan;
	const groups: { ref: NeedRef; lines: Plan['lines'] }[] = plan.needs.length
		? plan.needs.map((n) => ({
				ref: { needId: n.id, label: n.label },
				lines: plan.lines.filter((l) => l.needId === n.id)
			}))
		: plan.lines
				.filter((l) => !l.substituteFor)
				.map((l) => ({
					ref: { needId: l.id, label: l.productName ?? l.productId },
					lines: plan.lines.filter((x) => x.id === l.id || x.substituteFor === l.productId)
				}));

	// The plan's FulfilmentView (A2) is the exact partition: only receipt-backed quantity is supplier
	// confirmed (D10); any unresolved quantity is a residual. Without a view, line states decide.
	const fulfilment = new Map((plan.view?.fulfilment ?? []).map((f) => [f.needId, f]));
	for (const g of groups) {
		const f = fulfilment.get(g.ref.needId);
		if (f) {
			if (f.unresolved.value > 0 || f.status === 'uncovered') base.unresolvedNeeds.push(g.ref);
			else if (f.status === 'confirmed') base.confirmedNeeds.push(g.ref);
			else base.unconfirmedNeeds.push(g.ref);
			continue;
		}
		const active = g.lines.filter((l) => ACTIVE.has(l.state));
		if (!active.length) base.unresolvedNeeds.push(g.ref);
		else if (active.every((l) => l.state === 'committed')) base.confirmedNeeds.push(g.ref);
		else base.unconfirmedNeeds.push(g.ref);
	}
	if (o.approval && o.approval.state === 'pending') base.approvalIds.push(o.approval.id);

	const held = plan.lines.filter((l) => l.state === 'held');
	const unresolved = base.unresolvedNeeds.length;
	const covered = base.confirmedNeeds.length + base.unconfirmedNeeds.length;
	const waits = held.length > 0 || base.approvalIds.length > 0;
	// The words come from the one next-action rule; the status from the partition above.
	const next = nextFor(plan).text;

	if (o.intent === 'inspect')
		return {
			...base,
			status: 'fulfilled',
			nextAction: `Plan ${plan.id} v${plan.version}: ${next}`
		};
	if (unresolved) return { ...base, status: covered ? 'partial' : 'blocked', nextAction: next };
	if (waits) return { ...base, status: 'awaiting_user', nextAction: next };
	if (base.unconfirmedNeeds.length) return { ...base, status: 'partial', nextAction: next };
	return { ...base, status: 'fulfilled', nextAction: next };
}

/** Outcome of a goal that never reached the planner: a refusal, or one detail to ask the chef for. */
export function unsupportedOutcome(
	reason: string,
	extra: { clarify?: Clarify; brief?: GoalOutcome['brief'] } = {}
): GoalOutcome {
	const clarify = extra.clarify;
	return {
		status: clarify ? 'awaiting_user' : 'unsupported',
		intent: 'unsupported',
		planId: null,
		planVersion: null,
		confirmedNeeds: [],
		unconfirmedNeeds: [],
		unresolvedNeeds: [],
		approvalIds: [],
		nextAction: clarify
			? clarify.question
			: extra.brief
				? 'Use New request to get a menu proposal for this brief; nothing was planned.'
				: 'Nothing was done. Rephrase as a supported request or do it by hand.',
		reason,
		...(clarify ? { clarify } : {}),
		...(extra.brief ? { brief: extra.brief } : {})
	};
}
