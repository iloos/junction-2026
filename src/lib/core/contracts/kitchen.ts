import { z } from 'zod';
import { Cents, KitchenId, ProductId } from './primitives';

/** Ranking criteria a kitchen weighs; normalised to sum 1 before scoring (D6). */
export const Criterion = z.enum(['price', 'reliability', 'finnish', 'carbon', 'organic']);
export type Criterion = z.infer<typeof Criterion>;

export const Weights = z.partialRecord(Criterion, z.number().min(0));
export type Weights = z.infer<typeof Weights>;

export const OriginRule = z.object({
	categoryGroup: z.string(),
	rule: z.enum(['prefer', 'require']),
	country: z.string().length(2)
});

/** Things the agent may never decide alone, whatever the amount. */
export const NeverDelegate = z.enum([
	'allergen_change',
	'new_sku',
	'substitute_breaks_preference',
	'off_tender_list',
	'origin_requirement'
]);
export type NeverDelegate = z.infer<typeof NeverDelegate>;

/** The kitchen's mandate: the chef's words plus the enforceable numbers. Versioned; approvals bind to a version. */
export const Mandate = z.object({
	version: z.int().nonnegative().default(1),
	words: z.string(),
	lineCapCents: Cents,
	orderCapCents: Cents,
	weeklyCapCents: Cents,
	/**
	 * Above this an order is forbidden outright, approval or not: the mandate must be raised first.
	 * Default: the larger of 5× the order cap and 2× the weekly cap (see `hardLimitCents`).
	 */
	hardLimitCents: Cents.optional(),
	neverDelegate: z.array(NeverDelegate)
});
export type Mandate = z.infer<typeof Mandate>;

export const Kitchen = z.object({
	id: KitchenId,
	profile: z.string(),
	name: z.string(),
	kind: z.string(),
	city: z.string(),
	size: z.record(z.string(), z.number()),
	deliveryDays: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])),
	menuCycleWeeks: z.int().positive().optional(),
	weights: Weights,
	constraints: z.object({
		origin: z.array(OriginRule),
		allergens: z.object({
			freeFrom: z.array(z.string()),
			/** What to do when a product has no allergen record. */
			unknownCounts: z.enum(['hold', 'reject']),
			/** What to do when a product may contain (traces of) an excluded allergen. Default hold. */
			traces: z.enum(['hold', 'reject']).optional()
		}),
		tenderListOnly: z.boolean(),
		tenderList: z.array(ProductId).optional(),
		labels: z.array(z.string())
	}),
	mandate: Mandate,
	factorSensitivity: z.record(z.string(), z.number().min(0).max(1))
});
export type Kitchen = z.infer<typeof Kitchen>;
