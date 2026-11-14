/**
 * Lookup: catalogue search → ranked shortlist (≤5) with visible reasons → quote only the shortlist →
 * pick the first deliverable, priced, convertible candidate. Ranking is deterministic and explained;
 * constraints the chef stated are hard filters, defaults ("semi-skimmed") are preferences and say so.
 */
import type { NeedRequirements, Offer, Product } from '$lib/core/contracts';
import { meets, requirementsFromDiet } from '$lib/core/mandate/meets';
import { toLot } from '$lib/core/services/orders';
import { num } from '$lib/ui/format';
import { convert, type Conversion } from './convert';
import { PLANT_ALT, PRODUCTS } from './lexicon';
import { askOf, clashWith } from './checks';
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
	/** What the smallest order buys over the ask (2 = twice as much), when both are physical; null when unknown. */
	overshoot?: number | null;
	/** Set when the candidate stands in for the asked kind (a plant drink for "vegan milk"): asked before ordering. */
	nearMiss?: string;
}

/** An order more than this many times the ask is held with a question (need_rounding_large), never placed silently. */
export const ROUNDING_LIMIT = 2;

/** The smallest order's physical amount over the ask (after lot rounding), when both are in kg or l. */
export function overshoot(
	item: Pick<ParsedItem, 'qty' | 'unit'>,
	c: Conversion | null
): number | null {
	if (!c?.ok || !c.perSalesUnit || item.qty === null || item.qty <= 0) return null;
	if (item.unit !== 'kg' && item.unit !== 'l') return null;
	if (c.perSalesUnit.unit !== item.unit) return null;
	return (c.salesQty * c.perSalesUnit.value) / item.qty;
}

/** How well the smallest order fits the ask, lower first: within a quarter is a fit; unknown sits between. */
const fitRank = (o: number | null | undefined) =>
	o === null || o === undefined ? 0.5 : o <= 1.25 ? 0 : Math.log2(o);

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

/**
 * The item's stated requirements (lactose-free, organic, Finnish, gluten-free) judged by core's one evaluator (D16).
 * Unknown is not ok: a product with no record either way is passed over with the reason.
 */
function requirementFails(item: ParsedItem, p: Product): string | null {
	const req = requirementsOf(item.constraints, item.diet);
	if (!req) return null;
	const m = meets(p, req);
	if (m.verdict === 'ok') return null;
	const f = m.failing[0];
	return m.verdict === 'no' ? `not ${f.text}: ${f.why}` : `${f.text} not stated: ${f.why}`;
}

/** The request's stated constraints and diet asks as D16 requirements (diet through core's requirementsFromDiet). */
export function requirementsOf(
	constraints: readonly string[],
	diet: readonly string[] = []
): NeedRequirements | undefined {
	const fromDiet = requirementsFromDiet(diet);
	const freeFrom = [
		...(constraints.includes('lactose_free') ? ['LACTOSE'] : []),
		...(constraints.includes('gluten_free') ? ['GLUTEN'] : [])
	];
	const r: NeedRequirements = {
		...(freeFrom.length ? { freeFrom } : {}),
		...(constraints.includes('finnish') ? { origin: 'fi' } : {}),
		...(constraints.includes('organic') ? { labels: ['EU_ORGANIC_FARMING'] } : {})
	};
	if (fromDiet?.freeFrom) r.freeFrom = [...new Set([...(r.freeFrom ?? []), ...fromDiet.freeFrom])];
	if (fromDiet?.excludes) r.excludes = fromDiet.excludes;
	if (fromDiet?.diet) r.diet = fromDiet.diet;
	return Object.keys(r).length ? r : undefined;
}

/**
 * Filters one item's search hits (category, product word, stated constraints) and orders the rest by the
 * request's hand-set scores. Pure: the same hits always give the same order. Not core/rank, which ranks
 * substitutes by the kitchen's weights.
 */
export function filterHits(
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

		// "vegan milk": only the noun's plant alternative may stand in, labelled; another kind never does.
		const alt = !lex && item.kind ? PLANT_ALT[item.kind] : undefined;
		let nearMiss: string | undefined;
		if (alt) {
			if (!alt.categories.includes(p.category) || !alt.re.test(p.nameFi)) {
				reject(`not ${item.kind} or a ${alt.name}`);
				continue;
			}
			nearMiss = `a ${alt.name}: no vegan ${item.kind} in the catalogue`;
		}

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
		if (item.brand && !(p.brand ?? '').toLowerCase().startsWith(item.brand.toLowerCase())) {
			reject(`${p.brand ? `brand ${p.brand}` : 'no brand stated'}, you asked for ${item.brand}`);
			continue;
		}
		const fail = requirementFails(item, p);
		if (fail) {
			reject(fail);
			continue;
		}
		// A product that contradicts the words (soy for "cow") is never a match.
		const clash = clashWith(p, askOf(`${item.text} ${item.query}`));
		if (clash) {
			reject(clash);
			continue;
		}

		let score = 0;
		const reasons: string[] = nearMiss ? [nearMiss] : [];
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
		const over = overshoot(item, conversion);
		if (over !== null && over > 1.25)
			reasons.push(`the smallest order is ${num(over, 1)}× what you asked`);
		ranked.push({
			product: p,
			score: +score.toFixed(3),
			reasons,
			conversion,
			overshoot: over,
			...(nearMiss ? { nearMiss } : {})
		});
	}
	// The candidate whose smallest order best fits the ask comes first; the scores (and the kitchen's weights) order
	// the rest.
	ranked.sort(
		(a, b) =>
			fitRank(a.overshoot) - fitRank(b.overshoot) ||
			b.score - a.score ||
			(a.product.productId < b.product.productId ? -1 : 1)
	);
	return { ranked, rejected };
}

const hhmm = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Helsinki',
	weekday: 'short',
	hour: '2-digit',
	minute: '2-digit'
});

/** "17:00 Mon": when an offer's ordering closes, on the scenario clock's time zone. */
export function closesWords(iso: string): string {
	const parts = Object.fromEntries(hhmm.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
	return `${parts.hour}:${parts.minute} ${parts.weekday}`;
}

/** Set when ordering for this offer's date has closed at `now` (Valio's cut-off, D-1 Stock, D-2 Terminal). */
export function cutoffPassed(offer: Offer, now: Date): string | null {
	const c = offer.availability.closingTime;
	if (!c || Date.parse(c) > now.getTime()) return null;
	return `ordering closed at ${closesWords(c)}`;
}

/** Why a quoted candidate can't be picked, or null when it can. */
export function unpickable(
	offer: Offer | undefined,
	conversion: Conversion | null,
	now?: Date
): string | null {
	if (!offer) return 'no offer returned';
	if (now) {
		const closed = cutoffPassed(offer, now);
		if (closed) return closed;
	}
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
