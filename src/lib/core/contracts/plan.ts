import { z } from 'zod';
import { ErrorCode } from './errors';
import { AvailabilityKind, Offer } from './product';
import {
	Actor,
	Cents,
	IsoDate,
	IsoDateTime,
	KitchenId,
	Measure,
	MeasureUnit,
	ProductId,
	Provenance,
	SalesQty,
	Scope,
	UnitCode,
	WeightBasis
} from './primitives';

/** Mandate tiers: act alone, propose (chef can one-tap), sign-off (named authority). */
export const Tier = z.enum(['act', 'propose', 'sign_off']);
export type Tier = z.infer<typeof Tier>;

export const PolicyReason = z.enum([
	'new_sku',
	'substitute_breaks_preference',
	'origin_required',
	'off_tender_list',
	'allergen_unknown',
	'allergen_change',
	/** Declares an allergen the kitchen excludes: forbidden, never approvable. */
	'allergen_declared',
	/** May contain an excluded allergen: per the kitchen's traces policy. */
	'allergen_trace',
	/** Quantity not in the product's sales unit. */
	'unit_mismatch',
	/** No price: a fact gap, never approvable or committable. */
	'price_missing',
	/** A recall notice names this product: held for a human, find a substitute. */
	'recall',
	/** Line or order above the mandate's hard limit: forbidden, no approval can pass it. */
	'over_hard_limit',
	/** Quantity far beyond the dish need or any kitchen-sized order: a gap, check the quantity. */
	'qty_implausible',
	'low_reliability',
	'external_agent_needs_approval',
	'cutoff_passed'
]);
export type PolicyReason = z.infer<typeof PolicyReason>;

/**
 * Why a line is in its state. A union of D6 error codes (optionally with a sub-code, "CAP_EXCEEDED.weekly"),
 * availability kinds ("out", "undeliverable") and policy reasons. Errors are returned by calls; reasons explain states.
 */
export const LineReason = z.union([
	ErrorCode,
	z.templateLiteral([ErrorCode, '.', z.string()]),
	AvailabilityKind.exclude(['known']),
	PolicyReason
]);
export type LineReason = z.infer<typeof LineReason>;

/** Plan: draft → quoted → ready | held → committed. Any edit sends it back to draft and invalidates quote and approvals. */
export const PlanState = z.enum(['draft', 'quoted', 'ready', 'held', 'committed']);
export type PlanState = z.infer<typeof PlanState>;

/** Line: proposed → eligible | held | rejected | unorderable → committed. */
export const LineState = z.enum([
	'proposed',
	'eligible',
	'held',
	'rejected',
	'unorderable',
	'committed'
]);
export type LineState = z.infer<typeof LineState>;

/** Approval: pending → granted | denied | expired | invalidated. */
export const ApprovalState = z.enum(['pending', 'granted', 'denied', 'expired', 'invalidated']);
export type ApprovalState = z.infer<typeof ApprovalState>;

/** What a line is for: a dish/need on an event, or a direct request. */
export const Need = z.object({
	id: z.string(),
	label: z.string(),
	/**
	 * `dish`: a served amount per guest (seeded or proposed menu). `direct`: a physical amount someone asked for
	 * ("1 l lactose-free milk"); substitutes are sized to `amount`, not to the original product's sales units.
	 * Absent on plans stored before this field existed: read as `dish` when `dish` is set, else `direct`.
	 */
	kind: z.enum(['dish', 'direct']).optional(),
	/** Demand after factors: demand + target stock − usable stock − confirmed inbound (D6). */
	amount: Measure,
	/** For event dishes: what the chef edits and how the need was derived (the Why drawer and the kitchen table read this). */
	dish: z
		.object({
			gServed: z.number().nonnegative(),
			defaultGServed: z.number().nonnegative(),
			guests: z.int().nonnegative(),
			yield: z.number().positive(),
			/** e.g. "135 g × 140 ÷ 0.70 = 27.0 kg". */
			formula: z.string()
		})
		.optional(),
	provenance: Provenance
});
export type Need = z.infer<typeof Need>;

/**
 * How sure the supply behind a candidate is (D8). Ranking is lexicographic on this tier first, then on the weighted
 * score: `confirmed` stock and `make_in_house` from confirmed ingredients beat `unknown` (Terminal, 999999) and
 * `none`. Unknown candidates stay visible and labelled; they are never recommended over confirmed ones.
 */
export const SupplyTier = z.enum(['confirmed', 'make_in_house', 'unknown', 'none']);
export type SupplyTier = z.infer<typeof SupplyTier>;

/** One ranked candidate's score breakdown (D6 ranking). Missing values never score favourably. */
export const ScoreBreakdown = z.object({
	total: z.number(),
	supplyTier: SupplyTier.optional(),
	components: z.record(z.string(), z.object({ utility: z.number(), weight: z.number() })),
	fit: z.object({ score: z.number().min(0).max(4), provenance: Provenance }).optional(),
	excludedBy: z.array(z.string()).optional()
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

/**
 * Server-derived read model for one line (review round 4, triage #4): what the UI may do with it, so clients never
 * infer it from state + reasons. Computed at read time (it depends on the live approval), never stored.
 */
export const LineView = z.object({
	/** Held for a reason a human may accept: it belongs in the approval. */
	reviewable: z.boolean(),
	/** Can be committed now: in the mandate, or covered by a granted approval, and nothing blocks it. */
	committable: z.boolean(),
	/** Quantity backed by known stock (sales units; kg for KG-sold products). */
	confirmedCover: Measure,
	/** Quantity ordered or to be ordered whose supply is unknown (Terminal), never counted as cover. */
	unconfirmedCover: Measure,
	/** What the line's sales quantity is physically (13 ST of ham ≈ 26 kg net), when the pack content is known. */
	physical: Measure.optional(),
	/** Price per sales unit, as Valio sells it (€/ST, €/KI, €/KG). */
	unitPrice: z.object({ cents: Cents, per: UnitCode }).optional(),
	/** Price per physical unit for comparison across pack sizes, with the weight basis it uses. */
	comparisonPrice: z
		.object({ cents: Cents, per: MeasureUnit, basis: WeightBasis.optional() })
		.optional(),
	/** Why it cannot go ahead: a rule (forbid) or a missing/untrue fact (gap). */
	blockedReason: z
		.object({
			code: LineReason,
			effect: z.enum(['forbid', 'gap']),
			detail: z.enum(['qty', 'price', 'dietary_evidence', 'origin', 'unit', 'stock']).optional()
		})
		.optional(),
	nextAction: z.enum([
		'none',
		'approve',
		'commit',
		'find_substitute',
		'wait_for_supplier',
		'requote',
		'resolve_rule'
	])
});
export type LineView = z.infer<typeof LineView>;

export const Line = z.object({
	id: z.string(),
	needId: z.string().optional(),
	productId: ProductId,
	/** Display name (short Finnish name from the catalogue), so clients don't need a catalogue lookup. */
	productName: z.string().optional(),
	qty: SalesQty,
	state: LineState,
	tier: Tier.optional(),
	reasons: z.array(LineReason),
	/** Terms the line was quoted on; null until quoted. */
	offer: Offer.nullable(),
	lineCents: Cents.nullable(),
	/** How much of the need this line covers, and what is left. */
	covers: Measure.optional(),
	residual: Measure.optional(),
	/** Present when this line replaces another product. */
	substituteFor: ProductId.optional(),
	score: ScoreBreakdown.optional(),
	/** Read model, filled on tool outputs (see LineView). */
	view: LineView.optional(),
	/** Origin of the line: the event seed, the agent, a chef edit, an external client. */
	provenance: Provenance
});
export type Line = z.infer<typeof Line>;

/**
 * Server-derived coverage of one need (review round 5, F12): the one definition of "covered" that Kitchen, Ops,
 * Request and the agent's outcome all read. An exact partition of `required`, in the need's unit:
 *
 *   required = supplierConfirmed + awaitingSupplier + plannedKnown + plannedUnknown + unresolved
 *
 * - supplierConfirmed: committed, and the receipt confirmed it. The only amount an outcome may call fulfilled.
 * - awaitingSupplier: committed Terminal (unknown-quantity) lines: ordered, not confirmed.
 * - plannedKnown: uncommitted lines against known stock (eligible or held). Not reserved: stock can still move.
 * - plannedUnknown: uncommitted lines whose supply is unknown.
 * - unresolved: what nothing covers.
 * Lines allocate to the need in that order of certainty, each line once, up to `required`; what lines buy beyond it is
 * `excess` (lot rounding, overshoot), never counted as cover. Retries and partial receipts can't double-count because
 * allocation reads the plan's lines and the receipts once, by line id.
 */
export const FulfilmentView = z.object({
	needId: z.string(),
	label: z.string(),
	required: Measure,
	supplierConfirmed: Measure,
	awaitingSupplier: Measure,
	plannedKnown: Measure,
	plannedUnknown: Measure,
	unresolved: Measure,
	excess: Measure,
	status: z.enum(['confirmed', 'awaiting_supplier', 'planned', 'partial', 'uncovered']),
	/** Allocations behind the numbers, so the Why chain can show which line covers what. */
	allocations: z.array(
		z.object({
			lineId: z.string(),
			amount: Measure,
			bucket: z.enum([
				'supplierConfirmed',
				'awaitingSupplier',
				'plannedKnown',
				'plannedUnknown',
				'excess'
			])
		})
	)
});
export type FulfilmentView = z.infer<typeof FulfilmentView>;

/** Plan-level read model, computed at read time against the clock (F29). Never stored. */
export const PlanView = z.object({
	/** Scenario-clock time the view was computed at; `committable` on lines is true only as of this instant. */
	asOf: IsoDateTime,
	mandateVersion: z.int().nonnegative(),
	/** Earliest of the live approval's expiry and the quoted offers' cut-off, if any. */
	validUntil: IsoDateTime.optional(),
	fulfilment: z.array(FulfilmentView)
});
export type PlanView = z.infer<typeof PlanView>;

export const Plan = z.object({
	...Scope.shape,
	id: z.string(),
	kitchenId: KitchenId,
	/** Bumped on every change; approvals and commits name the version they saw (STALE_VERSION otherwise). */
	version: z.int().nonnegative(),
	state: PlanState,
	deliverBy: IsoDate,
	eventId: z.string().optional(),
	needs: z.array(Need),
	lines: z.array(Line),
	totalCents: Cents.nullable(),
	/** sha-256 over the canonical serialisation of the quoted lines (see core/hash.ts). */
	termsHash: z.string().nullable(),
	createdBy: Actor,
	idempotencyKey: z.string().optional(),
	/** Read model, filled on tool outputs (see PlanView). */
	view: PlanView.optional()
});
export type Plan = z.infer<typeof Plan>;

/**
 * What changed between the terms an approval was bound to and the plan now (shown when an approval is voided).
 * Computed from the op log; `before`/`after` are display strings in our own words.
 */
export const TermsDiff = z.array(
	z.object({
		lineId: z.string(),
		productId: ProductId.optional(),
		productName: z.string().optional(),
		change: z.enum(['added', 'removed', 'qty', 'product', 'price', 'state', 'need']),
		before: z.string().optional(),
		after: z.string().optional()
	})
);
export type TermsDiff = z.infer<typeof TermsDiff>;

/** Who allowed one order line: the mandate (act tier, nobody had to look) or a named approval. */
export const LineAuthority = z.union([z.literal('mandate'), z.object({ approvalId: z.string() })]);
export type LineAuthority = z.infer<typeof LineAuthority>;

export const Approval = z.object({
	...Scope.shape,
	id: z.string(),
	planId: z.string(),
	/** Bound to all four (D6): any change voids it. */
	planVersion: z.int().nonnegative(),
	termsHash: z.string(),
	mandateVersion: z.int().nonnegative(),
	/** Which lines, and why they needed approval. */
	lineIds: z.array(z.string()),
	tier: Tier,
	state: ApprovalState,
	requestedBy: Actor,
	decidedBy: Actor.optional(),
	expiresAt: IsoDateTime,
	reason: z.string().optional()
});
export type Approval = z.infer<typeof Approval>;

/** A committed order is immutable; failed commit attempts are separate outcomes (in the op log). */
export const Order = z.object({
	...Scope.shape,
	id: z.string(),
	planId: z.string(),
	planVersion: z.int().nonnegative(),
	kitchenId: KitchenId,
	lines: z.array(
		z.object({
			lineId: z.string(),
			productId: ProductId,
			qty: SalesQty,
			unitCents: Cents,
			lineCents: Cents,
			/**
			 * Per-line authority (F8): a mixed commit names, for each line, whether the mandate or an approval allowed
			 * it. Absent only on orders stored before this field existed; read those as the order-level `authority`.
			 */
			authority: LineAuthority.optional()
		})
	),
	totalCents: Cents,
	termsHash: z.string(),
	deliverBy: IsoDate,
	committedBy: Actor,
	committedAt: IsoDateTime,
	idempotencyKey: z.string(),
	/**
	 * Order-level summary: `mandate` only when every line is mandate-authorised, otherwise the approval that covered
	 * the held lines. The per-line `authority` is the audit record.
	 */
	authority: LineAuthority
});
export type Order = z.infer<typeof Order>;

/** The simulated supplier's confirmation. Approved ≠ stock confirmed: the receipt says what was confirmed. */
export const Receipt = z.object({
	...Scope.shape,
	id: z.string(),
	orderId: z.string(),
	confirmed: z.array(
		z.object({ productId: ProductId, qty: SalesQty, lotId: z.string().optional() })
	),
	/** Terminal (unknown-quantity) lines: ordered, not confirmed; they stay unconfirmed cover. */
	awaitingSupplier: z.array(z.object({ productId: ProductId, qty: SalesQty })).default([]),
	at: IsoDateTime,
	provenance: Provenance
});
export type Receipt = z.infer<typeof Receipt>;

export const AnomalyKind = z.enum([
	'out',
	'undeliverable',
	'below_lot',
	'unknown_quantity',
	'price_change',
	'contention',
	'cutoff',
	'recall',
	'demand_spike'
]);

export const Anomaly = z.object({
	...Scope.shape,
	id: z.string(),
	kind: AnomalyKind,
	productId: ProductId.optional(),
	planId: z.string().optional(),
	message: z.string(),
	detectedAt: IsoDateTime,
	provenance: Provenance
});
export type Anomaly = z.infer<typeof Anomaly>;
