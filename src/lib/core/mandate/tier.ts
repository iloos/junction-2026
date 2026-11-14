/**
 * Mandate tiering (PRODUCT ★4, D6): every quoted line becomes eligible (act), held (propose | sign_off, with
 * reasons) or unorderable. Caps gate the act tier only; an external caller always needs a human approval.
 */
import type {
	ActorKind,
	Kitchen,
	Line,
	LineReason,
	Need,
	NeedRequirements,
	Offer,
	PlanState,
	Product,
	SalesQty,
	Tier
} from '../contracts';
import type { TermsLine } from '../hash';
import { forbidden, hardLimitCents, mergeRequirements, validateLine } from './validate';

export interface DraftLine {
	id: string;
	needId?: string;
	productId: string;
	qty: SalesQty;
	provenance: Line['provenance'];
	substituteFor?: string;
	/** The fulfilment strategy the line belongs to (buy, substitute, make in house). */
	strategy?: Line['strategy'];
	/** Reasons the caller adds (e.g. allergen_change for a make-in-house recipe). */
	extraReasons?: LineReason[];
}

/** Reasons a caller adds that the data can't recompute; they survive every re-quote. */
const STICKY: ReadonlySet<string> = new Set([
	'allergen_change',
	'substitute_breaks_preference',
	'CAUTION.model_constraint',
	'CAUTION.model_fit',
	'requirement_relaxed.origin',
	'requirement_relaxed.labels',
	/** Kept at 0 through re-quotes until someone sets a quantity again. */
	'superseded'
]);

/** A stored line back to a draft for re-quoting, keeping its sticky reasons. */
export function draftFromLine(l: Line): DraftLine {
	const extraReasons = l.reasons.filter((r) => STICKY.has(r));
	return {
		id: l.id,
		needId: l.needId,
		productId: l.productId,
		qty: l.qty,
		provenance: l.provenance,
		substituteFor: l.substituteFor,
		...(l.strategy ? { strategy: l.strategy } : {}),
		...(extraReasons.length ? { extraReasons } : {})
	};
}

export interface TierInput {
	kitchen: Kitchen;
	lines: DraftLine[];
	offers: Map<string, Offer>;
	products: Map<string, Product>;
	/** Committed spend in the delivery week, read from the locked budget row. */
	weekSpentCents: number;
	/** Who asks now, and who created the plan: either being external means approval is required. */
	actor: ActorKind;
	createdBy: ActorKind;
	/** Products this kitchen has committed before (for never-delegate `new_sku`). */
	orderedBefore: Set<string>;
	/** Products named by a recall notice (from state.anomalies): their lines are held for sign-off. */
	recalled?: Set<string>;
	/** Scenario-clock now: a line whose offer cut-off has passed is forbidden (cutoff_passed). */
	now?: Date;
	/** What a line serving a dish needs, by line id (seedNeedQty): beyond 20× it the quantity is a gap. */
	expectedQty?: Map<string, { productId: string; value: number }>;
	/** Lines already committed stay as they are and are not re-tiered. */
	committed?: Line[];
	/** The plan's needs: a line is validated against its need's hard requirements. */
	needs?: readonly Need[];
	/** Order-scope requirements (Plan.requirements), applied to every line with its need's own. */
	orderRequirements?: NeedRequirements;
	/** The plan's delivery date: off the kitchen's receiving days, every line needs a sign-off. */
	deliverBy?: string;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** Whether the kitchen receives deliveries on this date (no calendar means any day). */
export function receivesOn(kitchen: Pick<Kitchen, 'deliveryDays'>, date: string): boolean {
	if (!kitchen.deliveryDays.length) return true;
	return kitchen.deliveryDays.includes(WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]);
}

export interface TierResult {
	lines: Line[];
	planState: PlanState;
	totalCents: number;
	termsLines: TermsLine[];
	/** Held, orderable lines that need an approval, and the strictest tier among them. */
	held: { lineIds: string[]; tier: Tier } | null;
}

const RANK: Record<Tier, number> = { act: 0, propose: 1, sign_off: 2 };
const TIER_OF: Partial<Record<string, Tier>> = {
	off_delivery_day: 'sign_off',
	requirement_unknown: 'sign_off',
	'requirement_relaxed.origin': 'sign_off',
	'requirement_relaxed.labels': 'sign_off',
	UNKNOWN_REQUIRED: 'propose',
	INSUFFICIENT_STOCK: 'propose',
	new_sku: 'propose',
	low_reliability: 'propose',
	allergen_unknown: 'sign_off',
	substitute_breaks_preference: 'sign_off',
	off_tender_list: 'sign_off',
	origin_required: 'sign_off',
	external_agent_needs_approval: 'sign_off',
	allergen_trace: 'sign_off',
	recall: 'sign_off',
	price_missing: 'propose',
	allergen_change: 'sign_off',
	'CAUTION.model_constraint': 'sign_off',
	'CAUTION.model_fit': 'propose'
};
const tierOf = (r: LineReason): Tier =>
	r.startsWith('CAP_EXCEEDED') ? 'sign_off' : (TIER_OF[r] ?? 'propose');
const maxTier = (rs: LineReason[]): Tier =>
	rs.map(tierOf).reduce<Tier>((a, b) => (RANK[b] > RANK[a] ? b : a), 'act');

/**
 * Products this kitchen counts as known for the never-delegate `new_sku` rule: anything it committed in this run plus
 * its standing-order baseline. Without the baseline a fresh run would treat the normal week's own products as new.
 */
export function orderedBefore(
	state: { orders: Record<string, { kitchenId: string; lines: { productId: string }[] }> },
	kitchen: Pick<Kitchen, 'id' | 'usualProducts'>
): Set<string> {
	return new Set([
		...(kitchen.usualProducts ?? []),
		...Object.values(state.orders)
			.filter((o) => o.kitchenId === kitchen.id)
			.flatMap((o) => o.lines.map((l) => l.productId))
	]);
}

/** Products under a recall notice in this workspace run. */
export function recalledProducts(state: {
	anomalies: Record<string, { kind: string; productId?: string }>;
}): Set<string> {
	return new Set(
		Object.values(state.anomalies)
			.filter((a) => a.kind === 'recall' && a.productId)
			.map((a) => a.productId!)
	);
}

export function tierLines(input: TierInput): TierResult {
	const { kitchen, offers, products } = input;
	const m = kitchen.mandate;
	const external = input.actor === 'external_agent' || input.createdBy === 'external_agent';
	type Work = {
		draft: DraftLine;
		offer: Offer | null;
		reasons: LineReason[];
		orderable: boolean;
		/** A fact gap (no price, not enough stock): held but never approvable. */
		gap: boolean;
		lineCents: number | null;
		/** Quantity 0: nothing to buy. */
		zero?: boolean;
	};

	const work: Work[] = input.lines.map((draft) => {
		const offer = offers.get(draft.productId) ?? null;
		const product = products.get(draft.productId);
		// Zero demand buys nothing: the line stays (a later need edit can bring it back) but is out of the order.
		if (draft.qty.value <= 0)
			return {
				draft,
				offer,
				reasons: (draft.extraReasons ?? []).filter((r) => r === 'superseded'),
				orderable: false,
				gap: false,
				lineCents: null,
				zero: true
			};
		// The shared validator decides what rules a line out, what is a fact gap and what a human may waive.
		const need = input.expectedQty?.get(draft.id);
		const findings = validateLine(kitchen, product, offer, draft.qty, {
			substitute: Boolean(draft.substituteFor),
			expectedQty: need?.productId === draft.productId ? need.value : undefined,
			requirements: mergeRequirements(
				input.orderRequirements,
				input.needs?.find((n) => n.id === draft.needId)?.requirements
			),
			relaxed: (draft.extraReasons ?? [])
				.filter((r) => r.startsWith('requirement_relaxed.'))
				.map((r) => r.slice('requirement_relaxed.'.length) as 'origin' | 'labels')
		});
		// The kitchen's calendar is a receiving constraint: another day is an explicit exception a person signs off.
		if (input.deliverBy && !receivesOn(kitchen, input.deliverBy))
			findings.push({ reason: 'off_delivery_day', effect: 'waive', tier: 'sign_off' });
		const ruledOut = forbidden(findings);
		// Ordering for this delivery has closed: nothing can buy it on these terms, approval or not (F9).
		const closes = offer?.availability.closingTime;
		if (input.now && closes && new Date(closes).getTime() <= input.now.getTime())
			ruledOut.push({ reason: 'cutoff_passed', effect: 'forbid' });
		if (ruledOut.length) {
			// Over the hard limit the line's cost is known and is the point: the plan reports it (F32).
			const over = ruledOut.some((f) => f.reason === 'over_hard_limit') && offer?.price;
			return {
				draft,
				offer,
				reasons: ruledOut.map((f) => f.reason),
				orderable: false,
				gap: false,
				lineCents: over ? Math.round(draft.qty.value * offer.price!.unitCents) : null
			};
		}
		const reasons: LineReason[] = findings.map((f) => f.reason);
		const gap = findings.some((f) => f.effect === 'gap');
		const lineCents = offer?.price ? Math.round(draft.qty.value * offer.price.unitCents) : null;
		if (m.neverDelegate.includes('new_sku') && !input.orderedBefore.has(draft.productId))
			reasons.push('new_sku');
		if (product?.reliability !== undefined && product.reliability < 0.7)
			reasons.push('low_reliability');
		if (lineCents !== null && lineCents > m.lineCapCents) reasons.push('CAP_EXCEEDED.line');
		if (input.recalled?.has(draft.productId)) reasons.push('recall');
		reasons.push(...(draft.extraReasons ?? []).filter((r) => !reasons.includes(r)));
		return { draft, offer, reasons, orderable: true, gap, lineCents };
	});

	const orderable = work.filter((w) => w.orderable);
	const orderableCents = orderable.reduce((s, w) => s + (w.lineCents ?? 0), 0);
	// The reported total also counts lines forbidden over the hard limit, so a forbidden order shows what it
	// would cost, whether one line or the sum crossed the limit.
	const totalCents =
		orderableCents +
		work
			.filter((w) => !w.orderable && w.reasons.includes('over_hard_limit'))
			.reduce((s, w) => s + (w.lineCents ?? 0), 0);
	// Over the hard limit the whole order is out: no approval can pass it, the mandate must change first.
	if (orderableCents > hardLimitCents(m))
		for (const w of orderable) {
			w.orderable = false;
			w.reasons = ['over_hard_limit'];
		}
	for (const w of orderable) {
		if (!w.orderable) continue;
		if (orderableCents > m.orderCapCents) w.reasons.push('CAP_EXCEEDED.order');
		if (input.weekSpentCents + orderableCents > m.weeklyCapCents)
			w.reasons.push('CAP_EXCEEDED.weekly');
		if (external) w.reasons.push('external_agent_needs_approval');
	}

	const lines: Line[] = work.map((w) => {
		const tier = w.orderable
			? w.gap
				? maxTier([...w.reasons, 'price_missing'])
				: maxTier(w.reasons)
			: undefined;
		const state: Line['state'] = w.zero
			? 'rejected'
			: !w.orderable
				? 'unorderable'
				: tier === 'act'
					? 'eligible'
					: 'held';
		return {
			id: w.draft.id,
			needId: w.draft.needId,
			productId: w.draft.productId,
			productName: products.get(w.draft.productId)?.nameFi,
			qty: w.draft.qty,
			state,
			tier,
			reasons: w.reasons,
			offer: w.offer,
			lineCents: w.lineCents,
			substituteFor: w.draft.substituteFor,
			...(w.draft.strategy ? { strategy: w.draft.strategy } : {}),
			provenance: w.draft.provenance
		};
	});
	const all = [...(input.committed ?? []), ...lines];
	const heldLines = lines.filter((l) => l.state === 'held');
	// Only waivable holds go to a human; a fact gap must be resolved first (a new quote, new terms).
	// A recalled line that already has a non-recalled replacement is superseded: one approval must never buy both.
	const superseded = (l: Line) =>
		l.reasons.includes('recall') &&
		all.some(
			(x) =>
				x.substituteFor === l.productId &&
				x.needId === l.needId &&
				x.state !== 'unorderable' &&
				!x.reasons.includes('recall')
		);
	const approvable = heldLines.filter(
		(l) => !work.find((w) => w.draft.id === l.id)?.gap && !superseded(l)
	);
	const open = lines.some((l) => l.state === 'eligible' || l.state === 'held');
	const planState: PlanState = heldLines.length ? 'held' : open ? 'ready' : 'held';
	return {
		lines: all,
		planState,
		totalCents,
		termsLines: all
			.filter((l) => l.state !== 'unorderable' && l.state !== 'rejected' && l.offer?.price)
			.map((l) => ({
				productId: l.productId,
				qty: l.qty.value,
				unit: l.qty.unit,
				unitCents: l.offer!.price!.unitCents,
				...(l.offer?.availability.kind && l.offer.availability.kind !== 'known'
					? { supply: l.offer.availability.kind }
					: {}),
				// A relaxed rule is part of what the approval agreed to: changing it changes the terms.
				...(l.reasons.some((r) => r.startsWith('requirement_relaxed.'))
					? {
							relaxed: l.reasons
								.filter((r) => r.startsWith('requirement_relaxed.'))
								.sort()
								.join(',')
						}
					: {})
			})),
		held: approvable.length
			? {
					lineIds: approvable.map((l) => l.id),
					tier: maxTier(approvable.flatMap((l) => l.reasons))
				}
			: null
	};
}

/** ISO 8601 week of a calendar date, e.g. 2026-11-16 → "2026-W47" (budget week = week of deliverBy). */
export function isoWeek(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	const day = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - day + 3);
	const year = d.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(year, 0, 4));
	const week =
		1 +
		Math.round(
			((d.getTime() - firstThursday.getTime()) / 864e5 -
				3 +
				((firstThursday.getUTCDay() + 6) % 7)) /
				7
		);
	return `${year}-W${String(week).padStart(2, '0')}`;
}
