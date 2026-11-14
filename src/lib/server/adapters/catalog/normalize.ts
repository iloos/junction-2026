/**
 * Valio raw records → contract shapes (docs/foundations/valio-data.md). Pure functions; the loaders do the I/O.
 * Rules (D5/D6): unknown stays unknown (no allergen record ≠ allergen-free, Terminal 999999 = unknown),
 * `allowedLotSize` is the lot step, money is integer cents.
 */
import type { Availability, Offer, Price, Product, Provenance } from '$lib/core/contracts';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Valio JSON is untyped by nature */
type Raw = any;

/** Category prefixes that are not food (valio-data.md, "Decisions for ARCHITECTURE" 7). */
const NON_FOOD = new Set(['20', '30', '32', '63', '64', '67', '77', '90']);
/** packagingMarkedLabel ids that are temperature words, not labels. */
const TEMPERATURE_WORDS = /temperature|frozen|chilled|ambient/i;
/** Availability amounts at or above this are Valio's "unlimited" sentinel (an assumption, D6). */
export const UNLIMITED_AT = 1e6;
/** Terminal (supplier-delivered) amount meaning "quantity unknown". */
export const TERMINAL_UNKNOWN = 999999;

const TEMPERATURE_CLASS: Record<number, Product['temperatureClass']> = {
	1: 'fresh',
	2: 'chilled',
	3: 'chilled',
	4: 'chilled',
	5: 'produce',
	7: 'frozen',
	8: 'ambient'
};

export const cents = (eur: number | null | undefined): number | null =>
	eur === null || eur === undefined || Number.isNaN(eur) ? null : Math.round(eur * 100);

function name(raw: Raw, lang: string): string | undefined {
	const n = (raw.synkkaData?.names ?? []).find((x: Raw) => x.language === lang);
	return n?.value?.trim() || undefined;
}

function classification(raw: Raw, cls: string): Raw[] {
	return (raw.synkkaData?.classifications ?? []).find((c: Raw) => c.name === cls)?.values ?? [];
}

/** Net content per sales unit from the base unit's netWeight (GRM/KGM/MLT/LTR) × base units per sales unit. */
function netPerSalesUnit(raw: Raw): Product['netPerSalesUnit'] {
	const base = (raw.synkkaData?.unitConversions ?? []).find(
		(u: Raw) => u.synkkaPackagingType === 'BASE_UNIT_OR_EACH'
	);
	const w = base?.netWeight;
	if (!w || !(w.value > 0)) return undefined;
	const perBase =
		w.unit === 'GRM'
			? { value: w.value / 1000, unit: 'kg' as const }
			: w.unit === 'KGM'
				? { value: w.value, unit: 'kg' as const }
				: w.unit === 'MLT'
					? { value: w.value / 1000, unit: 'l' as const }
					: w.unit === 'LTR'
						? { value: w.value, unit: 'l' as const }
						: null;
	if (!perBase) return undefined;
	const sales = (raw.units ?? []).find((u: Raw) => u.unitId === raw.salesUnit);
	const factor = raw.salesUnit === raw.baseUnit ? 1 : (sales?.sizeInBaseUnits ?? null);
	if (!factor) return undefined;
	return {
		value: { value: +(perBase.value * factor).toFixed(4), unit: perBase.unit },
		provenance: { source: 'valio_static', note: 'unitConversions.netWeight × units[]' }
	};
}

/** Bump when normalizeProduct's output changes: a cached normalised catalogue of another version is rebuilt. */
export const NORMALIZE_VERSION = '2';

const LITRES: Record<string, number> = { LTR: 1, DLT: 0.1, CLT: 0.01, MLT: 0.001 };
const KILOS: Record<string, number> = { KGM: 1, GRM: 0.001 };
/** Densities outside this are a unit slip in the source (1,000 "l" weighing 1 kg), never a product. */
const PLAUSIBLE_KG_PER_L = [0.3, 2] as const;

/**
 * Content volume per sales unit, only when Valio states both a volume in a volume unit and a net weight in a
 * weight unit for the base unit, and the two give a plausible density. Valio's `volume` often holds grams or pieces.
 */
function netVolumePerSalesUnit(raw: Raw): Product['netVolumePerSalesUnit'] {
	const base = (raw.synkkaData?.unitConversions ?? []).find(
		(u: Raw) => u.synkkaPackagingType === 'BASE_UNIT_OR_EACH'
	);
	const v = base?.volume;
	const w = base?.netWeight;
	if (!(v?.value > 0) || !(w?.value > 0)) return undefined;
	const l = LITRES[v.unit] !== undefined ? v.value * LITRES[v.unit] : null;
	const kg = KILOS[w.unit] !== undefined ? w.value * KILOS[w.unit] : null;
	if (l === null || kg === null) return undefined;
	const density = kg / l;
	if (density < PLAUSIBLE_KG_PER_L[0] || density > PLAUSIBLE_KG_PER_L[1]) return undefined;
	const sales = (raw.units ?? []).find((u: Raw) => u.unitId === raw.salesUnit);
	const factor = raw.salesUnit === raw.baseUnit ? 1 : (sales?.sizeInBaseUnits ?? null);
	if (!factor) return undefined;
	return {
		value: { value: +(l * factor).toFixed(4), unit: 'l' },
		provenance: {
			source: 'valio_static',
			note: `unitConversions.volume ${v.value} ${v.unit} beside netWeight ${w.value} ${w.unit} (${density.toFixed(3)} kg/l)`
		}
	};
}

export function normalizeProduct(
	raw: Raw,
	extra: { co2?: Map<string, number>; reliability?: Map<string, number> } = {}
): Product {
	const id = String(raw.id);
	const category = String(raw.category);
	const allergens = classification(raw, 'allergen');
	const claims = classification(raw, 'nutritionalClaim');
	const nameFi = name(raw, 'fi') ?? name(raw, 'en') ?? id;
	const flags: string[] = [];
	if (/POISTO|VANHA/i.test(nameFi)) flags.push('old_flagged_name');
	if (!raw.synkkaData?.unitConversions) flags.push('thin_record');
	const co2 = extra.co2?.get(id);
	const lotStep = Number(raw.allowedLotSize) || 0.01;
	return {
		productId: id,
		gtin: raw.salesUnitGtin ?? raw.synkkaData?.gtin ?? undefined,
		nameFi,
		nameEn: name(raw, 'en'),
		category,
		categoryGroup: category.slice(0, 2),
		isFood: !NON_FOOD.has(category.slice(0, 2)),
		vendor: String(raw.vendorName ?? ''),
		brand: raw.synkkaData?.brand ?? undefined,
		origin: raw.countryOfOrigin ? String(raw.countryOfOrigin).toLowerCase() : undefined,
		labels: classification(raw, 'packagingMarkedLabel')
			.map((v: Raw) => String(v.id))
			.filter((l: string) => !TEMPERATURE_WORDS.test(l)),
		temperatureClass: TEMPERATURE_CLASS[raw.temperatureCondition] ?? 'unknown',
		salesUnit: String(raw.salesUnit),
		baseUnit: String(raw.baseUnit),
		packs: (raw.units ?? []).map((u: Raw) => ({
			unit: String(u.unitId),
			baseUnits: Number(u.sizeInBaseUnits)
		})),
		lotStep,
		catchWeight:
			raw.salesUnit === 'KG' && (lotStep > 0.01 || Boolean(raw.synkkaData?.variableUnit)),
		netPerSalesUnit: netPerSalesUnit(raw),
		netVolumePerSalesUnit: netVolumePerSalesUnit(raw),
		co2PerKg:
			co2 === undefined
				? undefined
				: {
						value: co2,
						provenance: { source: 'valio_static', note: 'product-group average (AVG kg CO2-eq/kg)' }
					},
		reliability: extra.reliability?.get(id),
		allergens: {
			contains: allergens.filter((a: Raw) => a.unit === 'CONTAINS').map((a: Raw) => String(a.id)),
			mayContain: allergens
				.filter((a: Raw) => a.unit === 'MAY_CONTAIN')
				.map((a: Raw) => String(a.id)),
			declared: allergens.length > 0
		},
		freeFrom: claims
			.filter((c: Raw) => c.unit === 'FREE_FROM')
			.map((c: Raw) => String(c.synkkaId ?? c.id)),
		diet: claims
			.map((c: Raw) => String(c.synkkaId ?? c.id))
			.filter((c: string) => c === 'VEGAN' || c === 'VEGETARIAN')
			.map((c: string) => c.toLowerCase()),
		valioSubstitutes: (raw.substitutions ?? []).map((s: Raw) => String(s.substituteProduct)),
		dataQualityFlags: flags
	};
}

/** One product entry of POST /api/availability → D6 Availability (raw kept). */
export function normalizeAvailability(entry: Raw, provenance: Provenance): Availability {
	const line = (entry?.scheduleLines ?? [])[0];
	const base = {
		logisticModel: (entry?.logisticModel ?? null) as Availability['logisticModel'],
		availableDate: line?.availableDate ? String(line.availableDate).slice(0, 10) : null,
		closingTime: entry?.closingTime ? toIso(entry.closingTime) : null,
		raw: entry ?? null,
		provenance
	};
	if (!line) return { ...base, kind: 'undeliverable', amount: null };
	if (entry.salesBlock || line.salesBlock) return { ...base, kind: 'blocked', amount: null };
	const amount = Number(line.availableAmount);
	if (entry.logisticModel === 'Terminal' && amount === TERMINAL_UNKNOWN)
		return { ...base, kind: 'unknown', amount: null };
	if (amount <= 0) return { ...base, kind: 'out', amount: 0 };
	if (amount >= UNLIMITED_AT) return { ...base, kind: 'known', amount: null };
	return { ...base, kind: 'known', amount };
}

/** One product entry of POST /api/price → Price, or null when Valio reports an error for the id. */
export function normalizePrice(entry: Raw, provenance: Provenance): Price | null {
	if (!entry || entry.error || !entry.catalogPrice) return null;
	const unitCents = cents(entry.catalogPrice.value);
	if (unitCents === null) return null;
	const cmp = entry.comparisonPrice?.value;
	const cmpUnit = String(entry.comparisonUnit ?? '').toUpperCase();
	return {
		unitCents,
		listCents: cents(entry.listPrice?.value) ?? undefined,
		comparison:
			cmp != null && (cmpUnit === 'KG' || cmpUnit === 'L')
				? { cents: cents(cmp)!, unit: cmpUnit === 'KG' ? 'kg' : 'l' }
				: null,
		taxRate: Number(entry.tax?.taxRate ?? 0),
		validTo: entry.catalogPrice.validTo ? String(entry.catalogPrice.validTo).slice(0, 10) : null,
		provenance
	};
}

export function toOffer(
	productId: string,
	price: Raw | undefined,
	availability: Raw | undefined,
	provenance: Provenance
): Offer {
	return {
		productId,
		price: price ? normalizePrice(price, provenance) : null,
		availability: availability
			? normalizeAvailability(availability, provenance)
			: {
					kind: 'unknown',
					amount: null,
					logisticModel: null,
					availableDate: null,
					closingTime: null,
					raw: null,
					provenance: { ...provenance, note: 'no availability fetched' }
				}
	};
}

/** Valio timestamps look like 2026-11-15T17:00:00+0200; zod wants +02:00. */
export function toIso(t: string): string {
	return String(t).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}
