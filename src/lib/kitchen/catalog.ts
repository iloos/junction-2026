import buffet from '../../../fixtures/seeds/christmas-buffet-140.json';
import kitchensSeed from '../../../fixtures/seeds/kitchens.json';
import { Kitchen, type AvailabilityKind, type MeasureUnit } from '$lib/core/contracts';

/**
 * Product facts for the hero event, read from fixtures/seeds/christmas-buffet-140.json.
 * The seed holds prices (catalogPrice ex VAT, cached 14 Nov) and availability as the Valio mock returned it.
 * This is the fixture side of the data seam; the real API returns the same facts through `quote`.
 */

export const SEED = buffet;
export const CACHED_AT = '2026-11-14T10:00:00+02:00';
export const CACHE_REF = 'valio mock, cache tag support-seeds / hero-preflight';

export const KITCHENS: Kitchen[] = kitchensSeed.kitchens.map((k) => Kitchen.parse(k));

export type CategoryGroup = 'meat' | 'fish' | 'milk' | 'other';

export interface ProductFact {
	productId: string;
	name: string;
	salesUnit: string;
	/** Valio allowedLotSize in sales units. */
	lotStep: number;
	/** Physical amount per sales unit, in `measure` (1 for products sold per KG). */
	perUnit: number;
	measure: MeasureUnit;
	/** What the per-unit amount is: net, drained, pieces. */
	perUnitNote?: string;
	priceCents: number | null;
	availability: {
		kind: AvailabilityKind;
		/** Sales units; null = unlimited (known) or not stated (unknown). */
		amount: number | null;
		logistic: 'Stock' | 'Terminal' | null;
		/** The raw value Valio returned, kept for the Why drawer. */
		raw: string;
	};
	origin?: string;
	reliability?: number;
	co2PerKg?: number;
	categoryGroup: CategoryGroup;
}

interface RawAvailability {
	kind: string;
	amount?: number;
	logisticModel?: string | null;
}
interface RawProduct {
	productId: string;
	productName: string;
	salesUnit?: string;
	lotStep?: number;
	pack?: { netKg?: number; drainedKg?: number; netL?: number; pieces?: number };
	priceCents?: number;
	availability?: RawAvailability;
	origin?: string;
	reliability?: number;
	co2PerKg?: number;
}

const GROUPS: Record<string, CategoryGroup> = {
	'462490': 'meat',
	'462919': 'meat',
	'476768': 'meat',
	'476648': 'meat',
	'463159': 'meat',
	'462150': 'fish',
	'462016': 'fish',
	'471898': 'fish',
	'463876': 'fish',
	'463804': 'fish',
	'463928': 'fish',
	'464201': 'milk',
	'464249': 'milk',
	'471247': 'milk'
};

/** Facts the seed doesn't carry but the catalogue does (team-checked). */
const EXTRA: Record<string, Partial<ProductFact>> = {
	// Valio lactose-free milk: Finnish dairy.
	'464201': { origin: 'fi' },
	// Whole ham sold per KG on the bone; the seed gives the 7 kg lot.
	'462490': { origin: 'fi' },
	'476648': { perUnit: 1 },
	'463159': { perUnit: 1 }
};

const SENTINEL_UNKNOWN = 999999;

function normaliseAvailability(a: RawAvailability | undefined): ProductFact['availability'] {
	if (!a) return { kind: 'unknown', amount: null, logistic: null, raw: 'not fetched' };
	const logistic = (a.logisticModel as 'Stock' | 'Terminal' | null | undefined) ?? null;
	const raw = `${a.kind}${a.amount !== undefined ? ` ${a.amount}` : ''}${logistic ? ` · ${logistic}` : ''}`;
	// Valio: "unlimited" (≥999999) means availability unknown, any quantity orderable; never known stock.
	if (a.kind === 'unlimited') return { kind: 'unknown', amount: null, logistic, raw };
	if (a.kind === 'unknown' || a.amount === SENTINEL_UNKNOWN || logistic === 'Terminal')
		return { kind: 'unknown', amount: null, logistic, raw };
	if (a.kind === 'known')
		return {
			kind: 'known',
			amount: a.amount !== undefined && a.amount >= 1e9 ? null : (a.amount ?? null),
			logistic,
			raw
		};
	return { kind: a.kind as AvailabilityKind, amount: 0, logistic, raw };
}

function toFact(r: RawProduct): ProductFact {
	const salesUnit = r.salesUnit ?? 'KG';
	let perUnit = 1;
	let measure: MeasureUnit = 'kg';
	let perUnitNote: string | undefined;
	if (r.pack?.pieces) {
		perUnit = r.pack.pieces;
		measure = 'pcs';
		perUnitNote = `${r.pack.pieces} pcs`;
	} else if (r.pack?.drainedKg) {
		perUnit = r.pack.drainedKg;
		perUnitNote = `${r.pack.drainedKg} kg drained`;
	} else if (r.pack?.netL) {
		perUnit = r.pack.netL;
		measure = 'l';
		perUnitNote = `${r.pack.netL} l`;
	} else if (r.pack?.netKg) {
		perUnit = r.pack.netKg;
		perUnitNote = `${r.pack.netKg} kg net`;
	}
	return {
		productId: r.productId,
		name: r.productName,
		salesUnit,
		lotStep: r.lotStep ?? (salesUnit === 'KG' ? 0.01 : 1),
		perUnit,
		measure,
		perUnitNote,
		priceCents: r.priceCents ?? null,
		availability: normaliseAvailability(r.availability),
		origin: r.origin,
		reliability: r.reliability,
		co2PerKg: r.co2PerKg,
		categoryGroup: GROUPS[r.productId] ?? 'other',
		...EXTRA[r.productId]
	};
}

function collect(): Record<string, ProductFact> {
	const raws: RawProduct[] = [];
	for (const d of buffet.dishes as unknown as (RawProduct & { candidates?: RawProduct[] })[]) {
		raws.push(d);
		for (const c of d.candidates ?? []) raws.push(c);
	}
	const r = buffet.rescue as unknown as Record<
		string,
		{ chosen?: RawProduct & { ingredients?: RawProduct[] }; alternatives?: RawProduct[] }
	>;
	for (const key of Object.keys(r)) {
		const entry = r[key];
		if (!entry || typeof entry !== 'object') continue;
		if (entry.chosen?.productId) raws.push(entry.chosen);
		for (const i of entry.chosen?.ingredients ?? []) raws.push(i);
		for (const a of entry.alternatives ?? []) raws.push(a);
	}
	const out: Record<string, ProductFact> = {};
	for (const raw of raws) {
		const fact = toFact(raw);
		const prev = out[raw.productId];
		// First mention carries pack and unit; later mentions only fill gaps.
		out[raw.productId] = prev
			? {
					...fact,
					...Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== undefined)),
					availability: prev.availability
				}
			: fact;
	}
	return out;
}

export const PRODUCTS: Record<string, ProductFact> = collect();

export function product(id: string): ProductFact {
	const p = PRODUCTS[id];
	if (!p) throw new Error(`fixture has no product ${id}`);
	return p;
}
