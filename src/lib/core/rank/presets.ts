/**
 * Ranking presets for one request ("cheapest", "lowest carbon", "prefer Finnish", "most reliable"). A preset reweights
 * the order candidates are shown or picked in; it never changes which candidates pass the hard constraints, a line's
 * tier or its authority, and it is never persisted. Requiring an origin stays a mandate rule only a chef sets.
 */
import type { Product, RankBy, Weights } from '../contracts';

/** What a preference favours, in words for "Picked X over Y: <why>". */
export const PREFERENCE_WORDS: Record<Exclude<RankBy, 'default'>, string> = {
	price: 'cheaper',
	carbon: 'lower CO₂e',
	finnish: 'Finnish origin',
	reliability: 'more reliable supply'
};

/** "the lowest price", for "Ranked by … for this request". */
export const PREFERENCE_NAME: Record<Exclude<RankBy, 'default'>, string> = {
	price: 'the lowest price',
	carbon: 'the lowest CO₂e',
	finnish: 'Finnish origin',
	reliability: 'the most reliable supply'
};

export const isPreference = (r: RankBy | undefined | null): r is Exclude<RankBy, 'default'> =>
	!!r && r !== 'default';

/**
 * The kitchen's weights with the preferred criterion made dominant: three times the other weights together (at least
 * 1), so the kitchen's own weights still break ties among equals.
 */
export function presetWeights(base: Weights, rankBy: RankBy | undefined): Weights {
	if (!isPreference(rankBy)) return base;
	const rest = Object.entries(base)
		.filter(([k]) => k !== rankBy)
		.reduce((s, [, v]) => s + (v ?? 0), 0);
	return { ...base, [rankBy]: Math.max(1, rest * 3) };
}

/**
 * Catalogue hits in preference order on the static fields: carbon (CO₂e per kg, ascending), Finnish origin first,
 * reliability (descending). An unknown value sorts last, never favourably. Price needs live terms, so `price` (and
 * `default`) keep the search's own order. Stable: equals keep their relevance order.
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
