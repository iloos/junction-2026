/**
 * The line read model (LineView): derived from the line's state and reasons and the plan's current approval, so
 * the UI shows what the server decided instead of guessing. Pure; applied to every plan a tool returns.
 */
import type { Approval, Line, LineReason, LineView, Measure, Plan } from '../contracts';

type Detail = NonNullable<LineView['blockedReason']>['detail'];

/** Cause of a blocking reason, so "unknown" is never one undifferentiated state. */
const DETAIL: Partial<Record<string, Detail>> = {
	price_missing: 'price',
	INSUFFICIENT_STOCK: 'stock',
	out: 'stock',
	undeliverable: 'stock',
	blocked: 'stock',
	BELOW_LOT: 'qty',
	UNKNOWN_REQUIRED: 'qty',
	unit_mismatch: 'unit',
	origin_required: 'origin',
	allergen_declared: 'dietary_evidence',
	allergen_trace: 'dietary_evidence',
	allergen_unknown: 'dietary_evidence',
	NOT_FOUND: 'qty'
};
/** Facts that are missing or not true now: held, never approvable (validator effect `gap`). */
const GAPS = new Set<LineReason>(['price_missing', 'INSUFFICIENT_STOCK']);
/** Rule-outs a different product fixes (find a substitute) rather than a rule change. */
const SUPPLY = new Set<string>(['out', 'undeliverable', 'blocked', 'BELOW_LOT', 'NOT_FOUND']);

function measure(l: Line, value: number): Measure {
	return { value, unit: l.qty.unit === 'KG' ? 'kg' : 'pcs' };
}

type ApprovalLike = Pick<Approval, 'state' | 'lineIds' | 'planVersion'>;

export function lineView(l: Line, plan: Plan, approval: ApprovalLike | null): LineView {
	const unknown = l.offer?.availability.kind === 'unknown';
	const qty = l.qty.value;
	const covered = (n: number) => ({
		confirmedCover: measure(l, unknown ? 0 : n),
		unconfirmedCover: measure(l, unknown ? n : 0)
	});
	const none = { confirmedCover: measure(l, 0), unconfirmedCover: measure(l, 0) };

	if (l.state === 'committed')
		return {
			reviewable: false,
			committable: false,
			...covered(qty),
			nextAction: unknown ? 'wait_for_supplier' : 'none'
		};
	if (l.state === 'unorderable' || l.state === 'rejected') {
		const code = l.reasons[0] ?? 'NOT_FOUND';
		const replaced = plan.lines.some(
			(x) => x.substituteFor === l.productId && x.needId === l.needId
		);
		return {
			reviewable: false,
			committable: false,
			...none,
			blockedReason: { code, effect: 'forbid', detail: DETAIL[code] },
			nextAction: replaced ? 'none' : SUPPLY.has(code) ? 'find_substitute' : 'resolve_rule'
		};
	}
	const gap = l.reasons.find((r) => GAPS.has(r));
	if (gap)
		return {
			reviewable: false,
			committable: false,
			...none,
			blockedReason: { code: gap, effect: 'gap', detail: DETAIL[gap] },
			nextAction: gap === 'price_missing' ? 'requote' : 'find_substitute'
		};
	const current = approval && approval.planVersion === plan.version ? approval : null;
	if (l.state === 'eligible' && l.tier === 'act')
		return { reviewable: false, committable: true, ...covered(qty), nextAction: 'commit' };
	// Held for a reason a human may accept.
	const approved = current?.state === 'granted' && current.lineIds.includes(l.id);
	return {
		reviewable: true,
		committable: approved,
		...covered(qty),
		// A recalled product: approving stays possible (a human may judge the batch unaffected); replacing is the default.
		nextAction: approved ? 'commit' : l.reasons.includes('recall') ? 'find_substitute' : 'approve'
	};
}

/** The plan with every line's view filled, given its current approval (newest pending or granted). */
export function withLineViews(plan: Plan, approval: ApprovalLike | null): Plan {
	return { ...plan, lines: plan.lines.map((l) => ({ ...l, view: lineView(l, plan, approval) })) };
}
