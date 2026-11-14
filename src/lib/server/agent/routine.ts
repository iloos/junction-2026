import type { Product } from '$lib/core/contracts';
import { orderAmount } from '$lib/server/request/convert';
import { filterHits } from '$lib/server/request/lookup';
import { baseId, type ParsedItem } from '$lib/server/request/parse';
import { shortText } from './facts';
import type { Intent, RoutineLine } from './types';

type RoutineIntent = Extract<Intent, { kind: 'routine_order' }>;

/** Candidates a routine order shows the planner; the rest are counted, not listed. */
export const ROUTINE_SHORTLIST = 8;

export interface RoutineCandidate {
	productId: string;
	/** The request page's ranking score for this product and item (filterHits). */
	score?: number;
	/** The smallest order's amount over the ask (filterHits), for the shared candidate order (rankOrder). */
	overshoot?: number | null;
	name?: string;
	/** The product's sales unit, the unit `place_order` takes. */
	unit: string;
	lotStep?: number;
	origin?: string;
	/** Organic label: the one label the ranker weighs (in the kitchen's own weights). No raw label text reaches the planner. */
	organic?: boolean;
	/** CO₂e per kg (Valio's footprint file), for a carbon preference. */
	co2PerKg?: number;
	/** On-time share 0–1 (Valio's reliability file), for a reliability preference. */
	reliability?: number;
	/** Sales units that hold the asked quantity (rounded up), when the product states its content. */
	salesQty: number | null;
	/** What `salesQty` holds in total, when the product states its content (500 g asked → 0.5 kg or 4 kg). */
	amount: { value: number; unit: string } | null;
	/** How the quantity was converted, or why it can't be. Our text, from catalogue numbers. */
	conversion: string;
}

/** Every product a routine order asks for, the first one first. */
export function routineLines(i: RoutineIntent): RoutineLine[] {
	return [{ query: i.query, qty: i.qty, unit: i.unit, item: i.item }, ...(i.more ?? [])];
}

/** The catalogue words to search for one product: the parser's search words, else the chef's own. */
export const routineQueries = (l: RoutineLine): string[] =>
	l.item.search.length ? l.item.search : [l.query];

export interface RoutineFacts {
	/** Which product of the order the search was for (index into routineLines). */
	item?: number;
	/** Ranked like the request page ranks: lexicon category and name first, then fit. */
	products: RoutineCandidate[];
	/** Search hits ranked out (wrong category, a constraint not met), counted. */
	rejected: number;
	truncated?: { products: number };
	[k: string]: unknown;
}

/** The request parser's item for a routine intent, so ranking and conversion are the request page's own. */
export function routineItem(i: RoutineLine): ParsedItem {
	const item = {
		text: i.item.text || i.query,
		query: i.query,
		product: i.item.product,
		search: i.item.search,
		qty: i.qty,
		unit: i.unit,
		constraints: i.item.constraints,
		variant: i.item.variant,
		ambiguities: [],
		// Hard asks the request page filters on: never dropped between the reading and the order.
		...(i.item.diet?.length ? { diet: i.item.diet } : {}),
		...(i.item.brand ? { brand: i.item.brand } : {})
	};
	return { ...item, id: baseId(item) };
}

/**
 * Search hits for a routine order → ranked candidates with the asked quantity in each one's sales units
 * (`convert` from the request parser). A product whose content is unknown keeps `salesQty: null` and the
 * reason, so nothing downstream falls back to "N sales units".
 */
export function routineCandidates(intent: RoutineLine, hits: Product[]): RoutineFacts {
	const { ranked, rejected } = filterHits(routineItem(intent), hits);
	const out: RoutineFacts = {
		products: ranked.slice(0, ROUTINE_SHORTLIST).map((r) => ({
			productId: r.product.productId,
			score: r.score,
			overshoot: r.overshoot ?? null,
			name: shortText(r.product.nameShort?.value ?? r.product.nameFi),
			unit: r.product.salesUnit,
			lotStep: r.product.lotStep,
			origin: r.product.origin ?? undefined,
			...(r.product.labels.some((l) => /ORGANIC/i.test(l)) ? { organic: true } : {}),
			...(r.product.co2PerKg ? { co2PerKg: r.product.co2PerKg.value } : {}),
			...(r.product.reliability !== undefined ? { reliability: r.product.reliability } : {}),
			salesQty: r.conversion?.ok ? r.conversion.salesQty : null,
			amount: r.conversion?.ok ? orderAmount(r.product, r.conversion.salesQty) : null,
			conversion:
				shortText(
					r.conversion
						? r.conversion.ok
							? r.conversion.explain
							: `can't convert: ${r.conversion.reason}`
						: 'no quantity',
					160
				) ?? ''
		})),
		rejected: rejected.length
	};
	if (ranked.length > ROUTINE_SHORTLIST) out.truncated = { products: ranked.length };
	return out;
}

/**
 * The candidate to order: convertible, and the one whose rounded physical amount overshoots the ask least
 * (500 g of butter → one 500 g pack, not a 20 × 200 g case); ties, and candidates whose content isn't
 * comparable, keep the ranking's order.
 */
export function pickRoutine(
	intent: Pick<RoutineLine, 'qty' | 'unit'>,
	candidates: RoutineCandidate[]
): RoutineCandidate | null {
	const ok = candidates.filter((c) => c.salesQty !== null);
	const over = (c: RoutineCandidate) =>
		c.amount && c.amount.unit === intent.unit && intent.qty > 0
			? Math.round((c.amount.value / intent.qty) * 100) / 100
			: Number.POSITIVE_INFINITY;
	return ok.reduce<RoutineCandidate | null>(
		(best, c) => (best === null || over(c) < over(best) ? c : best),
		null
	);
}

/** A quoted offer as the planner's facts carry it. */
export interface OfferFacts {
	productId?: string;
	unitCents?: number;
	/** Valio's comparison price (per kg or l), when it states one: the price basis across pack sizes. */
	comparisonCents?: number;
	comparisonUnit?: string;
	availability?: string;
	logisticModel?: string;
	/** Sales units in stock, when Valio says (known availability). */
	amount?: number;
	availableDate?: string;
	closingTime?: string;
}

/**
 * Whether an offer can be bought for `deliverBy` as of `now`: priced, not out/blocked/undeliverable, available by the
 * date, and its order cut-off not passed (the gate refuses those at commit, A3). Unknown fields don't rule it out.
 */
export function orderable(o: OfferFacts | undefined, deliverBy: string, now?: string): boolean {
	if (!o || o.unitCents === undefined) return false;
	if (['out', 'blocked', 'undeliverable'].includes(o.availability ?? '')) return false;
	if (o.availableDate && o.availableDate > deliverBy) return false;
	if (now && o.closingTime && Date.parse(o.closingTime) <= Date.parse(now)) return false;
	return true;
}
