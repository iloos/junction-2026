/**
 * "Rank by" on /request: a per-request preference that re-orders the quoted shortlist with the substitute ranker's
 * weights and utilities (core/rank). It changes which product is picked, never a line's tier or the mandate: the order still goes
 * through place_order, which tiers it as always. Nothing is saved to the kitchen.
 */
import type { Kitchen, Offer, Product, Weights } from '$lib/core/contracts';
import { money, num } from '$lib/ui/format';

export const RANK_BY = ['kitchen', 'price', 'carbon', 'finnish', 'reliability'] as const;
export type RankBy = (typeof RANK_BY)[number];

/** One criterion at full weight, the kitchen's own weights a tenth as much to break ties. */
export function presetWeights(by: Exclude<RankBy, 'kitchen'>, kitchen: Kitchen): Weights {
	const own = Object.entries(kitchen.weights).map(([k, v]) => [k, (v ?? 0) * 0.1] as const);
	return { ...Object.fromEntries(own), [by]: 1 };
}

export function readRankBy(raw: unknown): RankBy {
	return typeof raw === 'string' && (RANK_BY as readonly string[]).includes(raw)
		? (raw as RankBy)
		: 'kitchen';
}

/**
 * How price is compared across the shortlist: the total cost to satisfy the request (sales quantity after lot
 * rounding × unit price) when at least two candidates have one; else Valio's comparison price when at least two
 * state it in the same unit; else none. Pack prices of different packs are never compared.
 */
export type PriceBasis = { kind: 'total' } | { kind: 'comparison'; unit: string } | null;

export function priceBasis(
	short: { product: Product; qty: number }[],
	offers: Map<string, Offer>
): PriceBasis {
	const totals = short.filter((s) => s.qty > 0 && offers.get(s.product.productId)?.price);
	if (totals.length >= 2) return { kind: 'total' };
	const units = short
		.map((s) => offers.get(s.product.productId)?.price?.comparison?.unit)
		.filter((u): u is NonNullable<typeof u> => !!u);
	const unit = units.find((u) => units.filter((x) => x === u).length >= 2);
	return unit ? { kind: 'comparison', unit } : null;
}

/** One candidate's price on the basis, or null when it has none there. */
function priceOn(
	b: PriceBasis,
	s: { product: Product; qty: number },
	o: Offer | undefined
): number | null {
	if (!b || !o?.price) return null;
	if (b.kind === 'total') return s.qty > 0 ? o.price.unitCents * s.qty : null;
	return o.price.comparison?.unit === b.unit ? o.price.comparison.cents : null;
}

/**
 * The shortlist's indices in the preference's order, by the weighted utilities core/rank uses (price on a common
 * basis relative to the best, carbon relative to the best, Finnish origin 1/0, reliability 0–1; a missing value
 * scores 0). Exclusions are not applied here: which candidates may be ordered is still the lookup's and the
 * mandate's call. Ties keep shortlist order. Null for the kitchen default, and for price with no common basis.
 */
export function preferenceOrder(
	by: RankBy,
	kitchen: Kitchen,
	short: { product: Product; qty: number }[],
	offers: Map<string, Offer>
): number[] | null {
	if (by === 'kitchen' || short.length < 2) return null;
	const basis = priceBasis(short, offers);
	if (by === 'price' && !basis) return null;
	const w = presetWeights(by, kitchen);
	const total = Object.values(w).reduce((x, v) => x + (v ?? 0), 0) || 1;
	const prices = short.map((s) => priceOn(basis, s, offers.get(s.product.productId)));
	const minPrice = Math.min(...prices.filter((x): x is number => x !== null && x > 0));
	const co2s = short.map((s) => s.product.co2PerKg?.value).filter((v): v is number => !!v && v > 0);
	const minCo2 = Math.min(...co2s);
	const score = (i: number) => {
		const { product } = short[i];
		const up = prices[i];
		const co2 = product.co2PerKg?.value;
		const u = {
			price: up !== null && up > 0 && Number.isFinite(minPrice) ? minPrice / up : 0,
			carbon: co2 && co2 > 0 && Number.isFinite(minCo2) ? minCo2 / co2 : 0,
			finnish: product.origin?.toLowerCase() === 'fi' ? 1 : 0,
			reliability: product.reliability ?? 0,
			organic: product.labels.some((l) => /ORGANIC/i.test(l)) ? 1 : 0
		};
		return (Object.keys(u) as (keyof typeof u)[]).reduce(
			(x, c) => x + ((w[c] ?? 0) / total) * u[c],
			0
		);
	};
	const scores = short.map((_, i) => score(i));
	return short.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
}

const LABEL: Record<RankBy, string> = {
	kitchen: 'the kitchen default',
	price: 'price',
	carbon: 'lowest carbon',
	finnish: 'Finnish origin',
	reliability: 'reliability'
};

/** The price difference on a common basis: the total to satisfy the request, else the same comparison unit. */
function priceDelta(
	a: { offer?: Offer; qty?: number },
	b: { offer?: Offer; qty?: number }
): string | null {
	const pa = a.offer?.price;
	const pb = b.offer?.price;
	if (pa && pb && a.qty && b.qty) {
		const d = pa.unitCents * a.qty - pb.unitCents * b.qty;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))} in total`;
	}
	const ca = pa?.comparison;
	const cb = pb?.comparison;
	if (ca && cb && ca.unit === cb.unit) {
		const d = ca.cents - cb.cents;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}/${ca.unit}`;
	}
	return null;
}

/** "Picked Valio X over Arla Y: −0.9 kg CO₂e/kg, +€0.12/kg", or that the preference kept the default. */
export function preferenceNote(
	by: RankBy,
	chosen: { product: Product; offer?: Offer; qty?: number } | null,
	defaultPick: { product: Product; offer?: Offer; qty?: number } | null,
	basis?: PriceBasis
): string | null {
	if (by === 'kitchen') return null;
	if (by === 'price' && basis === null)
		return 'Ranked by price: no common basis (the packs differ and Valio states no comparison price), so the kitchen default stands.';
	if (!chosen) return null;
	if (!defaultPick || defaultPick.product.productId === chosen.product.productId)
		return `Ranked by ${LABEL[by]}: same pick as the kitchen default, ${chosen.product.nameFi}.`;
	const parts: string[] = [];
	const c1 = chosen.product.co2PerKg?.value;
	const c0 = defaultPick.product.co2PerKg?.value;
	if (c1 !== undefined && c0 !== undefined && c1 !== c0)
		parts.push(`${c1 < c0 ? '−' : '+'}${num(Math.abs(c1 - c0), 1)} kg CO₂e/kg`);
	const p = priceDelta(chosen, defaultPick);
	if (p) parts.push(p);
	if (chosen.product.origin !== defaultPick.product.origin && chosen.product.origin)
		parts.push(`origin ${chosen.product.origin.toUpperCase()}`);
	if (
		chosen.product.reliability !== undefined &&
		defaultPick.product.reliability !== undefined &&
		chosen.product.reliability !== defaultPick.product.reliability
	)
		parts.push(
			`reliability ${num(chosen.product.reliability, 2)} vs ${num(defaultPick.product.reliability, 2)}`
		);
	return `Ranked by ${LABEL[by]}: picked ${chosen.product.nameFi} over ${defaultPick.product.nameFi}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}
