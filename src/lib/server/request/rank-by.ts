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

/** Price per comparison unit (kg/l) when stated, else per sales unit, as core/rank compares them. */
function unitPrice(o: Offer | undefined): { cents: number; basis: string } | null {
	if (!o?.price) return null;
	return o.price.comparison
		? { cents: o.price.comparison.cents, basis: o.price.comparison.unit }
		: { cents: o.price.unitCents, basis: 'unit' };
}

/**
 * The shortlist's indices in the preference's order, by the weighted utilities core/rank uses (price and carbon
 * relative to the best, Finnish origin 1/0, reliability 0–1; a missing value scores 0). Exclusions are not applied
 * here: which candidates may be ordered is still the lookup's and the mandate's call. Ties keep shortlist order.
 * Null for the kitchen default.
 */
export function preferenceOrder(
	by: RankBy,
	kitchen: Kitchen,
	short: { product: Product; qty: number }[],
	offers: Map<string, Offer>
): number[] | null {
	if (by === 'kitchen' || short.length < 2) return null;
	const w = presetWeights(by, kitchen);
	const total = Object.values(w).reduce((x, v) => x + (v ?? 0), 0) || 1;
	const prices = short.map((s) => unitPrice(offers.get(s.product.productId)));
	const basis = prices.find((x) => x && x.basis !== 'unit')?.basis ?? 'unit';
	const minPrice = Math.min(
		...prices
			.filter((x): x is { cents: number; basis: string } => !!x && x.basis === basis)
			.map((x) => x.cents)
	);
	const co2s = short.map((s) => s.product.co2PerKg?.value).filter((v): v is number => !!v && v > 0);
	const minCo2 = Math.min(...co2s);
	const score = (i: number) => {
		const { product } = short[i];
		const up = prices[i];
		const co2 = product.co2PerKg?.value;
		const u = {
			price: up && up.basis === basis && up.cents > 0 ? minPrice / up.cents : 0,
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

/** Price per comparison unit when both offers state the same one, else per sales unit. */
function priceDelta(a: Offer | undefined, b: Offer | undefined): string | null {
	const ca = a?.price?.comparison;
	const cb = b?.price?.comparison;
	if (ca && cb && ca.unit === cb.unit) {
		const d = ca.cents - cb.cents;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}/${ca.unit}`;
	}
	if (a?.price && b?.price) {
		const d = a.price.unitCents - b.price.unitCents;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))} per pack`;
	}
	return null;
}

/** "Picked Valio X over Arla Y: −0.9 kg CO₂e/kg, +€0.12/kg", or that the preference kept the default. */
export function preferenceNote(
	by: RankBy,
	chosen: { product: Product; offer?: Offer } | null,
	defaultPick: { product: Product; offer?: Offer } | null
): string | null {
	if (by === 'kitchen' || !chosen) return null;
	if (!defaultPick || defaultPick.product.productId === chosen.product.productId)
		return `Ranked by ${LABEL[by]}: same pick as the kitchen default, ${chosen.product.nameFi}.`;
	const parts: string[] = [];
	const c1 = chosen.product.co2PerKg?.value;
	const c0 = defaultPick.product.co2PerKg?.value;
	if (c1 !== undefined && c0 !== undefined && c1 !== c0)
		parts.push(`${c1 < c0 ? '−' : '+'}${num(Math.abs(c1 - c0), 1)} kg CO₂e/kg`);
	const p = priceDelta(chosen.offer, defaultPick.offer);
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
