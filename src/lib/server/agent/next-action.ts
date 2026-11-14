import type { ToolName } from '$lib/core/contracts';

/**
 * The one rule for "what should happen next" with a plan, read by get_context, every tool result's meta, the goal
 * outcome, the task ledger and the scripted planner, so no two surfaces disagree. Built from typed state only (line
 * states, FulfilmentView, the approval's state), never from product names or supplier text. Precedence:
 *
 * 1. an unorderable line with no live substitute → find_substitutes for it, unless its only problem is a passed
 *    cut-off: that is a date problem (pick a later delivery date), never a reason to change the product;
 * 2. lines within the mandate (eligible) → commit_order (held lines stay for a chef);
 * 3. held lines or a pending approval → a chef decides in the Kitchen screen;
 * 4. a need with unresolved quantity (no line covers it) → edit the need or find a substitute by hand;
 * 5. ordered lines awaiting the supplier → wait for the supplier;
 * 6. otherwise every need is supplier confirmed (or the plan has nothing open) → nothing to do.
 */
export type NextKind =
	'substitute' | 'date' | 'commit' | 'chef' | 'resolve' | 'await_supplier' | 'done';

export interface NextAction {
	kind: NextKind;
	/** One sentence in our own words. */
	text: string;
	/** The tool a client would call next, when there is one. */
	tool?: ToolName;
	args?: Record<string, unknown>;
	/** True when a human decision is what's left (the Kitchen approval panel). */
	needsChef: boolean;
	counts: {
		unorderable: number;
		eligible: number;
		held: number;
		unresolvedNeeds: number;
		awaitingSupplierNeeds: number;
	};
}

/** The structural slice of a plan the rule reads (a Plan or the agent's PlanFacts). */
export interface NextPlan {
	id: string;
	version: number;
	deliverBy?: string;
	lines: {
		id: string;
		productId: string;
		state: string;
		substituteFor?: string;
		reasons?: string[];
		/** The line's read model; an eligible line past its cut-off is not committable now. */
		view?: { committable?: boolean };
	}[];
	view?: {
		fulfilment: { needId: string; status: string; unresolved: { value: number } }[];
	};
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nextActionFor(plan: NextPlan, o: { approvalPending?: boolean } = {}): NextAction {
	const live = new Set(
		plan.lines
			.filter((l) => l.substituteFor && l.state !== 'unorderable')
			.map((l) => l.substituteFor)
	);
	const unorderable = plan.lines.filter((l) => l.state === 'unorderable' && !live.has(l.productId));
	const late = unorderable.filter((l) => l.reasons?.includes('cutoff_passed'));
	const out = unorderable.filter((l) => !l.reasons?.includes('cutoff_passed'));
	const eligible = plan.lines.filter(
		(l) => l.state === 'eligible' && l.view?.committable !== false
	).length;
	const held = plan.lines.filter((l) => l.state === 'held').length;
	const fulfilment = plan.view?.fulfilment ?? [];
	const unresolvedNeeds = fulfilment.filter(
		(f) => f.unresolved.value > 0 || f.status === 'uncovered'
	).length;
	const awaitingSupplierNeeds = fulfilment.filter((f) => f.status === 'awaiting_supplier').length;
	const counts = {
		unorderable: out.length,
		eligible,
		held,
		unresolvedNeeds,
		awaitingSupplierNeeds
	};
	const chefWaits = held > 0 || !!o.approvalPending;
	const heldText = held
		? `${plural(held, 'held line')} ${held === 1 ? 'waits' : 'wait'} for a chef in the Kitchen screen`
		: 'the approval waits for a chef in the Kitchen screen';

	if (out.length)
		return {
			kind: 'substitute',
			text: `Find a substitute for ${plural(out.length, 'unorderable line')}.`,
			tool: 'find_substitutes',
			args: { planId: plan.id, version: plan.version, lineId: out[0].id },
			needsChef: false,
			counts
		};
	if (late.length)
		return {
			kind: 'date',
			text: `The cut-off for ${plan.deliverBy ? `delivery on ${plan.deliverBy}` : 'this delivery date'} has passed for ${plural(late.length, 'line')}: pick a later delivery date (the product is not the problem).`,
			needsChef: false,
			counts
		};
	if (eligible)
		return {
			kind: 'commit',
			text:
				`Commit the ${plural(eligible, 'line')} within the mandate` +
				(chefWaits ? `; ${heldText}.` : '.'),
			tool: 'commit_order',
			args: { planId: plan.id, version: plan.version },
			needsChef: false,
			counts
		};
	if (chefWaits)
		return {
			kind: 'chef',
			text: `${heldText[0].toUpperCase()}${heldText.slice(1)}.`,
			tool: 'get_plan',
			args: { planId: plan.id },
			needsChef: true,
			counts
		};
	if (unresolvedNeeds)
		return {
			kind: 'resolve',
			text: `${plural(unresolvedNeeds, 'need')} ${unresolvedNeeds === 1 ? 'has' : 'have'} no line covering it: edit the need or find a substitute.`,
			needsChef: false,
			counts
		};
	if (awaitingSupplierNeeds)
		return {
			kind: 'await_supplier',
			text: `${plural(awaitingSupplierNeeds, 'need')} ordered, awaiting supplier confirmation.`,
			needsChef: false,
			counts
		};
	return {
		kind: 'done',
		text: fulfilment.length
			? 'Every need is supplier confirmed.'
			: plan.lines.length &&
				  plan.lines.every((l) => ['committed', 'rejected', 'unorderable'].includes(l.state))
				? 'Every line is ordered.'
				: 'Nothing is open on this plan.',
		needsChef: false,
		counts
	};
}
