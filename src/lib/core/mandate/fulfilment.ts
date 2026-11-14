/**
 * The one definition of "covered": per need, an exact partition of what is required into
 * supplier-confirmed, awaiting supplier, planned against known stock, planned against unknown stock and unresolved,
 * plus what lines buy beyond it (excess). Kitchen, Ops, Request and the agent's outcome read this; none recomputes it.
 *
 * Contributions to a need, each allocated once by line id:
 *  - a product line (the planned product or a substitute) covers its physical amount in the need's unit, scaled by
 *    the substitute's yield relative to the dish's;
 *  - a make-in-house recipe is one contribution: its ingredient lines are AND, so it covers what its scarcest
 *    ingredient supports, at the certainty of its least certain ingredient (pastry without filling makes no tarts);
 *  - a line nothing can buy (unorderable, rejected, a fact gap, superseded) covers nothing.
 * Allocation runs in order of certainty, up to `required`; the rest of each contribution is excess.
 * A dish need with a yield reports every amount as served (purchase × yield, `basis: 'served'`).
 * Pure: the caller supplies packs, recipe ratios and receipts (`FulfilmentFacts`).
 */
import type {
	FulfilmentView,
	Line,
	LineView,
	Measure,
	MeasureUnit,
	Need,
	Plan,
	WeightBasis
} from '../contracts';

/** Physical content of one sales unit. */
export interface PackContent {
	value: number;
	unit: MeasureUnit;
	basis?: WeightBasis;
}

export interface FulfilmentFacts {
	/** Physical content per sales unit of a line's product, when known (seed pack, else the catalogue's net content). */
	pack(line: Line): PackContent | undefined;
	/** How much need one unit of this line's physical amount serves (substitute yield ÷ dish yield); default 1. */
	coverFactor?(line: Line): number;
	/** Make-in-house ingredient: need (kg of dish) one sales unit supports = pack ÷ per. */
	recipeUnit?(line: Line): number | undefined;
	/** For committed lines: did the supplier's receipt confirm it? */
	receipt(lineId: string): 'confirmed' | 'awaiting' | undefined;
	/** Sales units the supplier's receipt confirmed for a committed line; absent means the whole line. */
	confirmedQty?(lineId: string): number | undefined;
}

type Bucket = FulfilmentView['allocations'][number]['bucket'];
const CERTAINTY: Exclude<Bucket, 'excess'>[] = [
	'supplierConfirmed',
	'awaitingSupplier',
	'plannedKnown',
	'plannedUnknown'
];

const round = (x: number) => Math.round(x * 1000) / 1000;
const m = (value: number, unit: MeasureUnit): Measure => ({
	value: round(Math.max(0, value)),
	unit
});

/** What a line's sales quantity is physically, when the pack content is known. KG-sold lines are their kg. */
export function physicalOf(line: Line, pack: PackContent | undefined): Measure | undefined {
	if (line.qty.unit === 'KG') return { value: round(line.qty.value), unit: 'kg', basis: 'net' };
	if (!pack) return undefined;
	return {
		value: round(line.qty.value * pack.value),
		unit: pack.unit,
		...(pack.basis ? { basis: pack.basis } : {})
	};
}

/** Price per sales unit, and per physical unit (Valio's comparison price, else derived from the pack). */
export function pricesOf(
	line: Line,
	pack: PackContent | undefined
): Pick<LineView, 'unitPrice' | 'comparisonPrice'> {
	const price = line.offer?.price;
	if (!price) return {};
	const unitPrice = { cents: price.unitCents, per: line.qty.unit };
	if (price.comparison)
		return {
			unitPrice,
			comparisonPrice: { cents: price.comparison.cents, per: price.comparison.unit }
		};
	const content =
		line.qty.unit === 'KG' ? { value: 1, unit: 'kg' as const, basis: 'net' as const } : pack;
	if (!content || content.value <= 0) return { unitPrice };
	return {
		unitPrice,
		comparisonPrice: {
			cents: Math.round(price.unitCents / content.value),
			per: content.unit,
			...(content.basis ? { basis: content.basis } : {})
		}
	};
}

/** Where a line's contribution sits, or null when it contributes nothing. */
function bucketOf(line: Line, view: LineView | undefined, facts: FulfilmentFacts): Bucket | null {
	if (line.qty.value <= 0) return null;
	if (line.state === 'committed')
		return facts.receipt(line.id) === 'confirmed' ? 'supplierConfirmed' : 'awaitingSupplier';
	if (!view || (!view.committable && !view.reviewable)) return null;
	return line.offer?.availability.kind === 'known' ? 'plannedKnown' : 'plannedUnknown';
}

/** A line's amount in the need's unit, or null when it can't be expressed in it. */
function amountIn(line: Line, unit: MeasureUnit, facts: FulfilmentFacts): number | null {
	const phys = physicalOf(line, facts.pack(line));
	if (!phys || phys.unit !== unit) return null;
	return phys.value * (facts.coverFactor?.(line) ?? 1);
}

const isRecipe = (l: Line) => l.strategy?.kind === 'make_in_house' || l.id.includes('-mih-');
const groupOf = (l: Line) => l.strategy?.id ?? `${l.needId}:mih`;

interface Contribution {
	lineIds: string[];
	amount: number;
	bucket: Bucket;
}

export function fulfilmentOf(
	need: Need,
	lines: Line[],
	views: Map<string, LineView | undefined>,
	facts: FulfilmentFacts
): FulfilmentView {
	const unit = need.amount.unit;
	const required = need.amount.value;
	// A dish need with a yield is reported as served (purchase × yield): what a raw original and a cooked substitute
	// put on the plate. Allocation runs in purchase units; only the reported amounts are scaled.
	const y = unit === 'kg' && need.dish && need.dish.yield !== 1 ? need.dish.yield : undefined;
	const out = (value: number) => m(value * (y ?? 1), unit);
	const contributions: Contribution[] = [];
	const own = lines.filter((l) => l.needId === need.id);

	for (const l of own.filter((x) => !isRecipe(x))) {
		const bucket = bucketOf(l, views.get(l.id), facts);
		// A sales-unit need (packs or cases, content unknown) counts sales units, not content (D18).
		const amount = bucket ? (need.kind === 'sales' ? l.qty.value : amountIn(l, unit, facts)) : null;
		if (!bucket || amount === null || !(amount > 0)) continue;
		// A receipt confirms what it says: 1 of 10 units confirmed is 1 confirmed and 9 still awaited.
		const cq = bucket === 'supplierConfirmed' ? facts.confirmedQty?.(l.id) : undefined;
		if (cq !== undefined && cq < l.qty.value) {
			const share = Math.max(0, cq) / l.qty.value;
			if (share > 0)
				contributions.push({
					lineIds: [l.id],
					amount: amount * share,
					bucket: 'supplierConfirmed'
				});
			contributions.push({
				lineIds: [l.id],
				amount: amount * (1 - share),
				bucket: 'awaitingSupplier'
			});
		} else contributions.push({ lineIds: [l.id], amount, bucket });
	}
	const recipes = new Map<string, Line[]>();
	for (const l of own.filter(isRecipe))
		recipes.set(groupOf(l), [...(recipes.get(groupOf(l)) ?? []), l]);
	for (const parts of recipes.values()) {
		let amount = Infinity;
		let worst = -1;
		for (const l of parts) {
			const bucket = bucketOf(l, views.get(l.id), facts);
			const per = facts.recipeUnit?.(l);
			if (!bucket || per === undefined) {
				amount = 0;
				break;
			}
			amount = Math.min(amount, l.qty.value * per);
			worst = Math.max(worst, CERTAINTY.indexOf(bucket as (typeof CERTAINTY)[number]));
		}
		if (amount > 0 && Number.isFinite(amount) && worst >= 0)
			contributions.push({ lineIds: parts.map((l) => l.id), amount, bucket: CERTAINTY[worst] });
	}

	contributions.sort(
		(a, b) =>
			CERTAINTY.indexOf(a.bucket as (typeof CERTAINTY)[number]) -
			CERTAINTY.indexOf(b.bucket as (typeof CERTAINTY)[number])
	);
	const sums: Record<Bucket, number> = {
		supplierConfirmed: 0,
		awaitingSupplier: 0,
		plannedKnown: 0,
		plannedUnknown: 0,
		excess: 0
	};
	const allocations: FulfilmentView['allocations'] = [];
	let left = required;
	for (const c of contributions) {
		const used = Math.min(c.amount, Math.max(0, left));
		left -= used;
		sums[c.bucket] += used;
		sums.excess += c.amount - used;
		// A recipe's allocation is the dish amount it serves; each ingredient line names it, and the sums count it once.
		for (const lineId of c.lineIds) {
			if (used > 0) allocations.push({ lineId, amount: out(used), bucket: c.bucket });
			if (c.amount - used > 0)
				allocations.push({ lineId, amount: out(c.amount - used), bucket: 'excess' });
		}
	}
	const unresolved = Math.max(0, left);
	const covered = required - unresolved;
	const status: FulfilmentView['status'] =
		unresolved > 1e-9
			? covered > 1e-9
				? 'partial'
				: 'uncovered'
			: sums.plannedKnown + sums.plannedUnknown > 1e-9
				? 'planned'
				: sums.awaitingSupplier > 1e-9
					? 'awaiting_supplier'
					: 'confirmed';
	return {
		needId: need.id,
		label: need.label,
		required: out(required),
		supplierConfirmed: out(sums.supplierConfirmed),
		awaitingSupplier: out(sums.awaitingSupplier),
		plannedKnown: out(sums.plannedKnown),
		plannedUnknown: out(sums.plannedUnknown),
		unresolved: out(unresolved),
		excess: out(sums.excess),
		...(y ? { basis: 'served' as const, yield: y } : {}),
		status,
		allocations
	};
}

/** Every need of a plan. */
export function planFulfilment(plan: Plan, facts: FulfilmentFacts): FulfilmentView[] {
	const views = new Map(plan.lines.map((l) => [l.id, l.view]));
	return plan.needs.map((n) => fulfilmentOf(n, plan.lines, views, facts));
}
