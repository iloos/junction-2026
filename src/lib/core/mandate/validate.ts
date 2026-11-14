/**
 * The one deterministic line validator, shared by tiering, ranking and commit.
 * Every finding says what it does to the line:
 *  - `forbid`: the kitchen's rules or Valio's facts rule it out; it is unorderable and no approval can pass it.
 *  - `gap`: a fact needed to form an order is missing (price) or not true now (stock); held, never approvable.
 *  - `waive`: a human may accept it (unknown Terminal quantity, tender list, a preference); held for approval.
 * Unknown never counts as fine: a missing allergen record or origin is treated by the kitchen's stated policy.
 */
import type { Kitchen, LineReason, Mandate, Offer, Product, SalesQty, Tier } from '../contracts';
import { inCategoryGroup } from './categories';

export type Effect = 'forbid' | 'gap' | 'waive';

export interface Finding {
	reason: LineReason;
	effect: Effect;
	/** Tier a waivable finding needs; forbid/gap findings are never approvable. */
	tier?: Tier;
}

export interface ValidateOptions {
	/** The line replaces another product: origin preferences then apply (a preference broken needs sign-off). */
	substitute?: boolean;
	/** What the dish needs, in the line's sales unit, when the line serves a dish. */
	expectedQty?: number;
}

/** The mandate's ceiling: above it nothing is orderable, whoever approves. */
export function hardLimitCents(m: Mandate): number {
	return m.hardLimitCents ?? Math.max(5 * m.orderCapCents, 2 * m.weeklyCapCents);
}

/** More than this many of the dish need is a typo, not an order. */
export const QTY_NEED_FACTOR = 20;
/** Without a dish need: more than this many of the product's largest pack is beyond any kitchen order. */
export const QTY_MAX_LARGEST_PACKS = 500;

function implausible(p: Product, qty: SalesQty, expected: number | undefined): boolean {
	if (expected !== undefined && expected > 0) return qty.value > QTY_NEED_FACTOR * expected;
	const per = p.packs.find((x) => x.unit === qty.unit)?.baseUnits ?? 1;
	const largest = Math.max(1, ...p.packs.map((x) => x.baseUnits));
	return qty.value * per > QTY_MAX_LARGEST_PACKS * largest;
}

const EPS = 1e-9;

/** Whether a quantity is a whole number of lots (and at least one). */
function onLot(qty: number, step: number): boolean {
	if (step <= 0.01) return qty > 0;
	const lots = qty / step;
	return qty >= step - EPS && Math.abs(lots - Math.round(lots)) < 1e-6;
}

export function validateLine(
	k: Kitchen,
	p: Product | undefined,
	o: Offer | null | undefined,
	qty: SalesQty,
	opts: ValidateOptions = {}
): Finding[] {
	const out: Finding[] = [];
	if (!p) return [{ reason: 'NOT_FOUND', effect: 'forbid' }];

	// Valio facts.
	const a = o?.availability;
	if (!o || !a) out.push({ reason: 'UNKNOWN_REQUIRED', effect: 'gap' });
	else if (a.kind === 'out' || a.kind === 'undeliverable' || a.kind === 'blocked')
		out.push({ reason: a.kind, effect: 'forbid' });
	else if (a.kind === 'unknown')
		out.push({ reason: 'UNKNOWN_REQUIRED', effect: 'waive', tier: 'propose' });
	else if (a.amount !== null && a.amount < qty.value)
		out.push(
			a.amount < p.lotStep
				? { reason: 'BELOW_LOT', effect: 'forbid' }
				: { reason: 'INSUFFICIENT_STOCK', effect: 'gap' }
		);
	if (o && !o.price) out.push({ reason: 'price_missing', effect: 'gap' });
	if (o?.price && Math.round(qty.value * o.price.unitCents) > hardLimitCents(k.mandate))
		out.push({ reason: 'over_hard_limit', effect: 'forbid' });
	if (implausible(p, qty, opts.expectedQty)) out.push({ reason: 'qty_implausible', effect: 'gap' });

	// Purchasable quantity: Valio sells in its sales unit, in whole lots.
	if (qty.unit !== p.salesUnit) out.push({ reason: 'unit_mismatch', effect: 'forbid' });
	else if (!onLot(qty.value, p.lotStep)) out.push({ reason: 'BELOW_LOT', effect: 'forbid' });

	// Allergens: declared contents, traces and missing records, by the kitchen's policy.
	const free = k.constraints.allergens.freeFrom;
	if (free.length) {
		if (p.allergens.contains.some((x) => free.includes(x)))
			out.push({ reason: 'allergen_declared', effect: 'forbid' });
		if (p.allergens.mayContain.some((x) => free.includes(x)))
			out.push(
				(k.constraints.allergens.traces ?? 'hold') === 'reject'
					? { reason: 'allergen_trace', effect: 'forbid' }
					: { reason: 'allergen_trace', effect: 'waive', tier: 'sign_off' }
			);
		if (!p.allergens.declared)
			out.push(
				k.constraints.allergens.unknownCounts === 'reject'
					? { reason: 'allergen_unknown', effect: 'forbid' }
					: { reason: 'allergen_unknown', effect: 'waive', tier: 'sign_off' }
			);
	}

	// Origin: a requirement rules out any other (or unknown) origin; a preference only binds substitutes.
	for (const r of k.constraints.origin) {
		if (!inCategoryGroup(p.category, r.categoryGroup)) continue;
		if (p.origin === r.country) continue;
		if (r.rule === 'require') out.push({ reason: 'origin_required', effect: 'forbid' });
		else if (opts.substitute)
			out.push({ reason: 'substitute_breaks_preference', effect: 'waive', tier: 'sign_off' });
	}

	// Tender list: anything off it goes to the named approver.
	if (k.constraints.tenderListOnly && !k.constraints.tenderList?.includes(p.productId))
		out.push({ reason: 'off_tender_list', effect: 'waive', tier: 'sign_off' });

	return out;
}

/** The reasons that rule a line out entirely. */
export const forbidden = (f: Finding[]) => f.filter((x) => x.effect === 'forbid');
/** The reasons no approval can pass (forbidden or a fact gap). */
export const blocking = (f: Finding[]) => f.filter((x) => x.effect !== 'waive');
