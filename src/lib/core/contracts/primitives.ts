import { z } from 'zod';

/** Six-digit Valio product id: the product key (D6). GTIN is optional packaging identity. */
export const ProductId = z.string().regex(/^\d{6}$/, 'six-digit Valio product id');
export type ProductId = z.infer<typeof ProductId>;

export const WorkspaceId = z.string().min(1);
export type WorkspaceId = z.infer<typeof WorkspaceId>;
/** A simulation or demo run inside a workspace; scenarios and resets get a fresh one. */
export const RunId = z.string().min(1);
export type RunId = z.infer<typeof RunId>;
export const KitchenId = z.string().min(1);
export type KitchenId = z.infer<typeof KitchenId>;

/** Money in integer cents, EUR, ex VAT unless a field says otherwise. */
export const Cents = z.int();
export type Cents = z.infer<typeof Cents>;

/** Valio sales/base unit codes seen in the catalogue (KI case, ST piece, KG, PAK, …). Open set: codes stay as given. */
export const UnitCode = z.string().min(1).max(8);
export type UnitCode = z.infer<typeof UnitCode>;

/** Physical measure units used for needs and comparison. */
export const MeasureUnit = z.enum(['kg', 'l', 'pcs']);
export type MeasureUnit = z.infer<typeof MeasureUnit>;

/** What a weight refers to: the pack's gross, net or drained weight. */
export const WeightBasis = z.enum(['gross', 'net', 'drained']);
export type WeightBasis = z.infer<typeof WeightBasis>;

/** A quantity in sales units (what Valio sells) with how it was rounded. */
export const SalesQty = z.object({
	value: z.number().nonnegative(),
	unit: UnitCode,
	/** Human-readable rounding, e.g. "11.5 kg → 2 × 10 kg lot = 20 kg". */
	rounding: z.string().optional()
});
export type SalesQty = z.infer<typeof SalesQty>;

/** A quantity in a physical measure (a need, or a comparison amount). */
export const Measure = z.object({
	value: z.number().nonnegative(),
	unit: MeasureUnit,
	basis: WeightBasis.optional()
});
export type Measure = z.infer<typeof Measure>;

/** Where a value came from. Shown in the UI next to the value; estimates never become facts (D6). */
export const Source = z.enum([
	'valio_live',
	'valio_cache',
	'valio_static',
	'simulator',
	'seed',
	'parsed',
	'category_estimate',
	'team_estimate',
	'llm',
	'web',
	'user'
]);
export type Source = z.infer<typeof Source>;

export const Provenance = z.object({
	source: Source,
	at: z.iso.datetime({ offset: true }).optional(),
	/** URL, cache key, model id or seed path. */
	ref: z.string().optional(),
	note: z.string().optional()
});
export type Provenance = z.infer<typeof Provenance>;

/** Who did something. Server-derived from the credential, never taken from the request body (D6). */
export const ActorKind = z.enum([
	'chef',
	'kitchen_agent',
	'external_agent',
	'approver',
	'system',
	'job'
]);
export type ActorKind = z.infer<typeof ActorKind>;

export const Actor = z.object({
	kind: ActorKind,
	/** Key id, user id or job name. */
	id: z.string().min(1)
});
export type Actor = z.infer<typeof Actor>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();

/** Every record and op carries these (D6). */
export const Scope = z.object({
	workspaceId: WorkspaceId,
	runId: RunId
});
export type Scope = z.infer<typeof Scope>;
