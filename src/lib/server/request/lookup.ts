/**
 * Lookup: catalogue search → ranked shortlist (≤5) with visible reasons → quote only the shortlist →
 * pick the first deliverable, priced, convertible candidate. Ranking is deterministic and explained;
 * constraints the chef stated are hard filters, defaults ("semi-skimmed") are preferences and say so.
 */
import type { Offer, Product } from '$lib/core/contracts';
import { toLot } from '$lib/core/services/orders';
import { convert, type Conversion } from './convert';
import { PRODUCTS } from './lexicon';
import type { ParsedItem } from './parse';

export const SHORTLIST = 5;

/**
 * The conversion rounded up to the product's lot step, the same rounding place_order applies, so
 * the preview's quantity, price and size checks are what will be ordered.
 */
export function withLot(c: Conversion, p: Product): Conversion {
	if (!c.ok) return c;
	const lot = toLot(c.salesQty, c.salesUnit, p);
	if (lot.value === c.salesQty || !lot.rounding) return c;
	return {
		...c,
		salesQty: lot.value,
		exact: false,
		explain: `${c.explain}; ordered in lots of ${p.lotStep}: ${lot.value} ${c.salesUnit}`,
		warnings: [...c.warnings, `rounded up to the lot size: ${lot.rounding}`]
	};
}

export interface Ranked {
	product: Product;
	score: number;
	reasons: string[];
	conversion: Conversion | null;
}

export interface Rejected {
	productId: string;
	name: string;
	reason: string;
}

const tokens = (name: string) =>
	name
		.toLowerCase()
		.split(/[^\p{L}\d]+/u)
		.filter(Boolean);

function constraintFails(item: ParsedItem, p: Product): string | null {
	const t = tokens(p.nameFi);
	for (const c of item.constraints) {
		if (c === 'lactose_free' && !(p.freeFrom.includes('LACTOSE') || t.includes('laktoositon')))
			return 'not lactose-free';
		if (
			c === 'organic' &&
			!(p.labels.includes('EU_ORGANIC_FARMING') || t.some((w) => w.startsWith('luomu')))
		)
			return 'not organic';
		if (c === 'finnish' && p.origin !== 'fi')
			return `origin ${p.origin?.toUpperCase() ?? 'unknown'}, not Finnish`;
		if (c === 'gluten_free' && !(p.freeFrom.includes('GLUTEN') || t.includes('gluteeniton')))
			return 'not gluten-free';
	}
	return null;
}

/** Ranks search hits for one item. Pure: the same hits always give the same order. */
export function rankCandidates(
	item: ParsedItem,
	hits: Product[]
): { ranked: Ranked[]; rejected: Rejected[] } {
	const lex = PRODUCTS.find((p) => p.key === item.product) ?? null;
	const ranked: Ranked[] = [];
	const rejected: Rejected[] = [];
	const seen = new Set<string>();
	for (const p of hits) {
		if (seen.has(p.productId)) continue;
		seen.add(p.productId);
		const reject = (reason: string) =>
			rejected.push({ productId: p.productId, name: p.nameFi, reason });
		const t = tokens(p.nameFi);

		if (lex?.categories && !lex.categories.includes(p.category)) {
			reject(`not in the ${lex.key} category (${p.category})`);
			continue;
		}
		if (
			lex &&
			!t.some(
				(w) =>
					w === lex.search || w.endsWith(lex.search) || (lex.compound && w.startsWith(lex.search))
			)
		) {
			const near = t.find((w) => w.includes(lex.search));
			reject(near ? `"${near}", not ${lex.search}` : `name does not say ${lex.search}`);
			continue;
		}
		const fail = constraintFails(item, p);
		if (fail) {
			reject(fail);
			continue;
		}

		let score = 0;
		const reasons: string[] = [];
		if (item.constraints.length)
			reasons.push(`meets: ${item.constraints.map((c) => c.replace('_', '-')).join(', ')}`);
		const want =
			item.variant ?? (lex?.prefer ? { token: lex.prefer.token, label: lex.prefer.reason } : null);
		if (want && t.some((w) => w === want.token || w.endsWith(want.token))) {
			score += 3;
			reasons.push(item.variant ? `the ${item.variant.label} you asked for` : want.label);
		}
		const conversion =
			item.qty !== null && item.unit ? withLot(convert(item.qty, item.unit, p), p) : null;
		if (conversion?.ok) {
			score += 2;
			if (conversion.exact) score += 1;
			else reasons.push('quantity needs rounding up');
			// Bigger units mean fewer pieces to handle (1 l beats 0.5 l for 1,000 l).
			if (conversion.perSalesUnit && conversion.perSalesUnit.value >= 1) score += 0.5;
		} else if (conversion && !conversion.ok) {
			score -= 5;
			reasons.push(`can't convert: ${conversion.reason}`);
		}
		if (p.reliability !== undefined) score += p.reliability * 0.5;
		ranked.push({ product: p, score: +score.toFixed(3), reasons, conversion });
	}
	ranked.sort((a, b) => b.score - a.score || (a.product.productId < b.product.productId ? -1 : 1));
	return { ranked, rejected };
}

/** Why a quoted candidate can't be picked, or null when it can. */
export function unpickable(offer: Offer | undefined, conversion: Conversion | null): string | null {
	if (!offer) return 'no offer returned';
	const k = offer.availability.kind;
	if (k === 'undeliverable') return "Valio can't deliver it to this kitchen on this date";
	if (k === 'out') return 'out of stock at Valio';
	if (k === 'blocked') return 'blocked by Valio';
	if (!offer.price) return 'no price from Valio';
	if (!conversion) return 'no quantity to convert';
	if (!conversion.ok) return conversion.reason;
	if (
		k === 'known' &&
		offer.availability.amount !== null &&
		offer.availability.amount < conversion.salesQty
	)
		return `only ${offer.availability.amount} ${conversion.salesUnit} available`;
	return null;
}
