import { z } from 'zod';
import { Cents, IsoDateTime, MeasureUnit, ProductId, Provenance, UnitCode } from './primitives';

/** A value derived from something other than Valio's own field, with where it came from. */
export const Derived = <T extends z.ZodType>(value: T) =>
	z.object({ value, provenance: Provenance });

export const TemperatureClass = z.enum([
	'ambient',
	'chilled',
	'frozen',
	'fresh',
	'produce',
	'unknown'
]);
export type TemperatureClass = z.infer<typeof TemperatureClass>;

/** One entry of the pack hierarchy from Valio `units[]`, e.g. KI = 6 ST. */
export const PackLevel = z.object({ unit: UnitCode, baseUnits: z.number().positive() });

/**
 * Normalised catalogue product (docs/foundations/valio-data.md §6). One row per productId.
 * Static truth for search and ranking; live price and availability live in `Offer`.
 */
export const Product = z.object({
	productId: ProductId,
	gtin: z.string().optional(),
	nameFi: z.string(),
	nameEn: z.string().optional(),
	nameShort: Derived(z.string()).optional(),
	category: z.string().regex(/^\d{5}$/),
	categoryGroup: z.string().regex(/^\d{2}$/),
	categoryLabel: Derived(z.string()).optional(),
	isFood: z.boolean(),
	vendor: z.string(),
	brand: z.string().optional(),
	origin: z.string().length(2).optional(),
	labels: z.array(z.string()),
	temperatureClass: TemperatureClass,
	salesUnit: UnitCode,
	baseUnit: UnitCode,
	packs: z.array(PackLevel),
	/** Valio `allowedLotSize`: hard minimum and step in sales units (D6). */
	lotStep: z.number().positive(),
	/** Catch-weight: sold per KG with a lot step above 0.01. */
	catchWeight: z.boolean(),
	/** Net content per sales unit; absent when unknown. Never inferred silently: provenance says parsed/llm. */
	netPerSalesUnit: Derived(
		z.object({ value: z.number().positive(), unit: MeasureUnit })
	).optional(),
	co2PerKg: Derived(z.number().nonnegative()).optional(),
	/** 0–1 from Valio's reliability file; absent = unknown, never invented. */
	reliability: z.number().min(0).max(1).optional(),
	allergens: z.object({
		contains: z.array(z.string()),
		mayContain: z.array(z.string()),
		/** False when Valio has no allergen record: absent ≠ allergen-free. */
		declared: z.boolean()
	}),
	freeFrom: z.array(z.string()),
	diet: z.array(z.string()),
	/** Valio's own `substitutions` rules, first in the candidate list (D6). */
	valioSubstitutes: z.array(ProductId),
	dataQualityFlags: z.array(z.string())
});
export type Product = z.infer<typeof Product>;

/** D6 availability kinds. `raw` keeps Valio's value. */
export const AvailabilityKind = z.enum(['known', 'unknown', 'out', 'undeliverable', 'blocked']);
export type AvailabilityKind = z.infer<typeof AvailabilityKind>;

export const Availability = z.object({
	kind: AvailabilityKind,
	/** Sales units available; only for `known`. `null` with kind known = unlimited (≥ 1e6 sentinel, an assumption). */
	amount: z.number().nonnegative().nullable(),
	logisticModel: z.enum(['Stock', 'Terminal']).nullable(),
	availableDate: z.iso.date().nullable(),
	/** Order cut-off for availableDate, as the simulator clock sees it. */
	closingTime: IsoDateTime.nullable(),
	raw: z.unknown(),
	provenance: Provenance
});
export type Availability = z.infer<typeof Availability>;

export const Price = z.object({
	/** Price we pay per sales unit, ex VAT (`catalogPrice.value`). */
	unitCents: Cents,
	listCents: Cents.optional(),
	comparison: z.object({ cents: Cents, unit: MeasureUnit }).nullable(),
	taxRate: z.number().nonnegative(),
	validTo: z.iso.date().nullable(),
	provenance: Provenance
});
export type Price = z.infer<typeof Price>;

/** Live terms for one product at one moment. Terms hashes are computed over this (minus provenance timestamps). */
export const Offer = z.object({
	productId: ProductId,
	price: Price.nullable(),
	availability: Availability
});
export type Offer = z.infer<typeof Offer>;
