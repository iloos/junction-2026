import type { Plan, ToolOutput } from '$lib/core/contracts';
import type { GoalOutcome, IntentKind, NeedRef } from './types';

type Approval = ToolOutput<'get_plan'>['approval'];

/** Lines that can still supply something: not out of the running. */
const ACTIVE = new Set(['proposed', 'eligible', 'held', 'committed']);

/**
 * GoalOutcome from domain state. Each need (or, for a plan without needs, each line) is confirmed when
 * every active line covering it is committed, unconfirmed when active lines cover it but some are not
 * committed, unresolved when no active line covers it. Precedence of the status:
 * unresolved needs → partial (blocked if nothing else is covered); a pending approval or held line →
 * awaiting_user; everything committed → fulfilled; otherwise partial (eligible lines not committed).
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

	for (const g of groups) {
		const active = g.lines.filter((l) => ACTIVE.has(l.state));
		if (!active.length) base.unresolvedNeeds.push(g.ref);
		else if (active.every((l) => l.state === 'committed')) base.confirmedNeeds.push(g.ref);
		else base.unconfirmedNeeds.push(g.ref);
	}
	if (o.approval && o.approval.state === 'pending') base.approvalIds.push(o.approval.id);

	const held = plan.lines.filter((l) => l.state === 'held');
	const eligible = plan.lines.filter((l) => l.state === 'eligible');
	const unresolved = base.unresolvedNeeds.length;
	const covered = base.confirmedNeeds.length + base.unconfirmedNeeds.length;
	const waits = held.length > 0 || base.approvalIds.length > 0;
	const heldWhy = [...new Set(held.flatMap((l) => l.reasons))].join(', ');

	if (o.intent === 'inspect')
		return {
			...base,
			status: 'fulfilled',
			nextAction: waits
				? `Plan ${plan.id} v${plan.version}: ${held.length} held line(s) wait for the chef${heldWhy ? ` (${heldWhy})` : ''}.`
				: `Plan ${plan.id} v${plan.version} is ${plan.state}.`
		};
	if (unresolved)
		return {
			...base,
			status: covered ? 'partial' : 'blocked',
			nextAction:
				`${unresolved} need(s) have no orderable line: ${base.unresolvedNeeds
					.map((n) => n.label)
					.slice(0, 5)
					.join(', ')}. ` +
				'Find a substitute or edit the need.' +
				(waits ? ` ${held.length} held line(s) also wait for the chef.` : '')
		};
	if (waits)
		return {
			...base,
			status: 'awaiting_user',
			nextAction:
				`The chef decides ${held.length} held line(s)${heldWhy ? ` (${heldWhy})` : ''}` +
				(base.approvalIds.length ? ` on approval ${base.approvalIds[0]}` : '') +
				(eligible.length ? `; ${eligible.length} eligible line(s) can be committed now.` : '.')
		};
	if (base.unconfirmedNeeds.length)
		return {
			...base,
			status: 'partial',
			nextAction: `${eligible.length} eligible line(s) are within the mandate and not committed yet: commit them.`
		};
	return {
		...base,
		status: 'fulfilled',
		nextAction: `Every need of plan ${plan.id} is covered by committed lines.`
	};
}

/** Outcome of a goal that never reached the planner. */
export function unsupportedOutcome(reason: string, clarify = false): GoalOutcome {
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
			? reason
			: 'Nothing was done. Rephrase as a supported request or do it by hand.',
		reason
	};
}
