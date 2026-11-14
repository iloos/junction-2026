/**
 * Ranking presets for one request ("cheapest", "lowest carbon", "prefer Finnish", "most reliable"): the one definition
 * /request, the chat agent, find_substitutes and search_products share. A preset reweights the order candidates are
 * shown or picked in; it never changes which candidates pass the hard constraints, a line's tier or its authority, and
 * it is never persisted. Requiring an origin stays a mandate rule only a chef sets.
 */
import type { Kitchen, Offer, Product, RankBy, Weights } from '../contracts';

/** The presets, in /request's order; `kitchen` is the kitchen's own weights. */
export const RANK_BY = ['kitchen', 'price', 'carbon', 'finnish', 'reliability'] as const;
export type { RankBy };

/** What a preference favours, in words for "Picked X over Y: <why>". */
export const PREFERENCE_WORDS: Record<Exclude<RankBy, 'kitchen'>, string> = {
	price: 'cheaper',
	carbon: 'lower CO₂e',
	finnish: 'Finnish origin',
	reliability: 'more reliable supply'
};

/** "the lowest price", for "Ranked by … for this request". */
export const PREFERENCE_NAME: Record<Exclude<RankBy, 'kitchen'>, string> = {
	price: 'the lowest price',
	carbon: 'the lowest CO₂e',
	finnish: 'Finnish origin',
	reliability: 'the most reliable supply'
};

export const isPreference = (r: RankBy | undefined | null): r is Exclude<RankBy, 'kitchen'> =>
	!!r && r !== 'kitchen';

/** One criterion at full weight, the kitchen's own weights a tenth as much to break ties. */
export function presetWeights(
	by: Exclude<RankBy, 'kitchen'>,
	kitchen: Pick<Kitchen, 'weights'>
): Weights {
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
	kitchen: Pick<Kitchen, 'weights'>,
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

/**
 * Catalogue hits in preference order on the static fields: carbon (CO₂e per kg, ascending), Finnish origin first,
 * reliability (descending). An unknown value sorts last, never favourably. Price needs live terms, so `price` (and
 * `kitchen`) keep the search's own order. Stable: equals keep their relevance order.
 */
export function sortByPreference(products: Product[], rankBy: RankBy | undefined): Product[] {
	const key: ((p: Product) => number | null) | null =
		rankBy === 'carbon'
			? (p) => p.co2PerKg?.value ?? null
			: rankBy === 'finnish'
				? (p) => (p.origin ? (p.origin.toUpperCase() === 'FI' ? 0 : 1) : null)
				: rankBy === 'reliability'
					? (p) => (p.reliability === undefined ? null : -p.reliability)
					: null;
	if (!key) return products;
	return products
		.map((p, i) => ({ p, i, k: key(p) }))
		.sort((a, b) =>
			a.k === null && b.k === null
				? a.i - b.i
				: a.k === null
					? 1
					: b.k === null
						? -1
						: a.k - b.k || a.i - b.i
		)
		.map((x) => x.p);
}
