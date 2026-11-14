/**
 * Copy and geometry for a need's coverage (FulfilmentView), in the D10 vocabulary: "supplier confirmed" only for
 * receipt-backed amounts; planned stock is not reserved; unknown supply is never cover; excess is not cover.
 * Pure, so the bar, the Why chain and tests read one definition.
 */
import type { FulfilmentView, LineView, Measure } from '$lib/core/contracts';
import { money, num } from './format';

export type Bucket =
	'supplierConfirmed' | 'awaitingSupplier' | 'plannedKnown' | 'plannedUnknown' | 'unresolved';

/** In order of certainty, most certain first: the bar fills left to right in this order. */
/** `cls` is the D10 supply fill (layout.css `supply-*`): solid observed, hatched not yet true, outline missing. */
export const BUCKETS: { key: Bucket; label: string; hint: string; cls: string }[] = [
	{
		key: 'supplierConfirmed',
		label: 'Supplier confirmed',
		hint: 'ordered, and the supplier confirmed the quantity',
		cls: 'supply-confirmed'
	},
	{
		key: 'awaitingSupplier',
		label: 'Ordered, awaiting supplier',
		hint: 'ordered; the supplier has not confirmed a quantity',
		cls: 'supply-awaiting'
	},
	{
		key: 'plannedKnown',
		label: 'Planned, known stock',
		hint: 'not ordered yet; stock is known but not reserved',
		cls: 'supply-known'
	},
	{
		key: 'plannedUnknown',
		label: 'Planned, stock unknown',
		hint: 'not ordered yet; the supplier states no quantity, so it is not cover',
		cls: 'supply-unknown'
	},
	{
		key: 'unresolved',
		label: 'Not covered',
		hint: 'nothing in the plan covers this amount',
		cls: 'supply-missing'
	}
];

export const EXCESS = {
	label: 'Bought over the need',
	hint: 'pack and lot rounding; not counted as cover',
	cls: 'supply-excess'
};

export interface Segment {
	key: Bucket | 'excess';
	label: string;
	cls: string;
	value: number;
	/** Share of the bar's full width (required + excess), 0..1. */
	width: number;
}

const amount = (m: Measure) => `${num(m.value, m.value < 10 ? 2 : 1)} ${m.unit}`;

/** Bar segments: the partition of `required`, then excess past the required mark. */
export function segments(f: FulfilmentView): { parts: Segment[]; requiredAt: number } {
	const total = f.required.value + f.excess.value;
	const share = (v: number) => (total > 0 ? v / total : 0);
	const parts: Segment[] = BUCKETS.filter((b) => f[b.key].value > 0).map((b) => ({
		key: b.key,
		label: b.label,
		cls: b.cls,
		value: f[b.key].value,
		width: share(f[b.key].value)
	}));
	if (f.excess.value > 0)
		parts.push({
			key: 'excess',
			label: EXCESS.label,
			cls: EXCESS.cls,
			value: f.excess.value,
			width: share(f.excess.value)
		});
	return { parts, requiredAt: share(f.required.value) };
}

/** One sentence a chef can read aloud: what is needed, how it is covered, and what is not. */
export function coverageSentence(f: FulfilmentView): string {
	const u = f.required.unit;
	const m = (v: number) => amount({ value: v, unit: u });
	const bits: string[] = [];
	if (f.supplierConfirmed.value > 0)
		bits.push(`${m(f.supplierConfirmed.value)} supplier confirmed`);
	if (f.awaitingSupplier.value > 0)
		bits.push(`${m(f.awaitingSupplier.value)} ordered, awaiting supplier`);
	if (f.plannedKnown.value > 0) bits.push(`${m(f.plannedKnown.value)} planned against known stock`);
	if (f.plannedUnknown.value > 0)
		bits.push(`${m(f.plannedUnknown.value)} planned with unknown stock`);
	if (f.unresolved.value > 0) bits.push(`${m(f.unresolved.value)} not covered`);
	let s = `Need ${amount(f.required)}: ${bits.join(', ') || 'nothing planned'}.`;
	if (f.excess.value > 0) s += ` Packs add ${m(f.excess.value)} over the need.`;
	return s;
}

/**
 * Short headline for the need's coverage, led by the weakest certainty present, plus what packs add over the need:
 * "5.6 kg on unknown stock · +1.6 kg over".
 */
export function coverageHeadline(f: FulfilmentView): { text: string; tone: Bucket } {
	const u = f.required.unit;
	const m = (v: number) => amount({ value: v, unit: u });
	const over = f.excess.value > 0 ? ` · +${m(f.excess.value)} over` : '';
	if (f.unresolved.value > 0)
		return { text: `${m(f.unresolved.value)} not covered${over}`, tone: 'unresolved' };
	if (f.plannedUnknown.value > 0)
		return { text: `${m(f.plannedUnknown.value)} on unknown stock${over}`, tone: 'plannedUnknown' };
	if (f.plannedKnown.value > 0)
		return { text: `${m(f.plannedKnown.value)} planned, known stock${over}`, tone: 'plannedKnown' };
	if (f.awaitingSupplier.value > 0)
		return { text: `Ordered, awaiting supplier${over}`, tone: 'awaitingSupplier' };
	return { text: `Supplier confirmed${over}`, tone: 'supplierConfirmed' };
}

const BASIS: Record<string, string> = { net: 'net', drained: 'drained', gross: 'gross' };

/**
 * What a line buys, physically and per unit: "13 ST ≈ 19.5 kg net" and "€15.43 / ST · €10.29 / kg". Falls back to
 * the sales quantity alone when the pack content is unknown (never guesses a weight).
 */
export function lineBasis(
	qty: { value: number; unit: string },
	view: Pick<LineView, 'physical' | 'unitPrice' | 'comparisonPrice'> | undefined
): { buys: string; physical: string | null; unitPrice: string | null; comparison: string | null } {
	const buys = `${num(qty.value)} ${qty.unit}`;
	const p = view?.physical;
	const sameAsSales =
		p && p.unit === qty.unit.toLowerCase() && Math.abs(p.value - qty.value) < 1e-9;
	const physical =
		p && !sameAsSales
			? `≈ ${num(p.value, p.value < 10 ? 2 : 1)} ${p.unit}${p.basis && BASIS[p.basis] ? ` ${BASIS[p.basis]}` : ''}`
			: null;
	const unitPrice = view?.unitPrice ? `${money(view.unitPrice.cents)}/${view.unitPrice.per}` : null;
	const cp = view?.comparisonPrice;
	const comparison =
		cp && !(view?.unitPrice && cp.per.toUpperCase() === view.unitPrice.per.toUpperCase())
			? `${money(cp.cents)}/${cp.per}${cp.basis && cp.basis !== 'net' ? ` ${cp.basis}` : ''}`
			: null;
	return { buys, physical, unitPrice, comparison };
}
