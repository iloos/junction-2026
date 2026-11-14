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
	'cutoff_passed',
	/** The product does not meet a hard requirement of the need it serves (lactose-free, origin, label): forbidden. */
	'requirement_unmet',
	/** No record says whether the product meets a requirement (diet, allergens): held or rejected per unknownCounts. */
	'requirement_unknown',
	/** D18: the line buys more than its need by over one lot step (250 ml asked, 250 l bought): forbidden. */
	'exceeds_need',
	/** D18: the need's amount is physical but this product's content per unit is unknown: held for a person. */
	'need_size_unknown',
	/** Lot rounding buys more than twice the ask (250 ml as a 5 l case): held for a person, since it may be the only pack. */
	'need_rounding_large',
	/** A person accepted the best try: this line breaks the order's origin requirement only. Sign-off, in the terms. */
	'requirement_relaxed.origin',
	/** A person accepted the best try: this line lacks a required label only. Sign-off, in the terms. */
	'requirement_relaxed.labels',
	/** The delivery date is not one of the kitchen's receiving days: held for a named approver to accept or reschedule. */
	'off_delivery_day',
	/** A substitute replaced this line's purchase: it stays visible at quantity 0 and is not bought. */
	'superseded',
	/** Gemini says the product may break a hard constraint the catalogue has no record of: held for a human. */
	'CAUTION.model_constraint',
	/** Gemini scored this substitute 0 of 4 for fit in the dish: still the best by the rules, but a person checks it. */
	'CAUTION.model_fit'
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
/**
 * Hard requirements of one need, from the request ("lactose-free", "Finnish", "organic"). Every line serving the need
 * must meet them: ranking rejects candidates that don't, and the validator forbids such a line at quote and commit.
 * Kitchen-wide constraints still apply on top.
 */
export const NeedRequirements = z.object({
	/**
	 * Free-from requirements in the catalogue's upper-case codes (LACTOSE, GLUTEN, MILK): met by the product's
	 * free-from claim, or by a declared allergen record without the matching allergen (iceberg lettuce is lactose-free
	 * without saying so).
	 */
	freeFrom: z.array(z.string()).optional(),
	/** Country of origin the product must have: ISO 3166-1 alpha-2 in lower case, as in the catalogue ("fi", not "FI"). */
	origin: z.string().length(2).optional(),
	/** Labels the product must carry (Product.labels, e.g. organic). */
	labels: z.array(z.string()).optional(),
	/**
	 * Diet the product must suit (a dish's VEG / VE code, a request's "vegetarian"): no meat or fish, and for vegan no
	 * milk or egg either. From the product's diet record, else its allergens, category and name. Never relaxed.
	 */
	diet: z.array(z.enum(['vegetarian', 'vegan'])).optional(),
	/**
	 * Product families the need must not contain (a dish's M code excludes milk, G gluten cereals; "no pork"). From
	 * the allergen record, the category groups (core/mandate/categories.ts) and the name. An undeclared record is
	 * unknown, never ok.
	 */
	excludes: z.array(z.enum(['meat', 'fish', 'pork', 'milk', 'gluten_cereals'])).optional()
});

/**
 * Why a product misses one requirement, as the evaluator (core/mandate/meets.ts) decided it. The same shape in the
 * line read model, get_plan, explain_line, refusals and the MCP/REST answers, so an agent can repair it, not guess.
 */
export const RequirementCheck = z.object({
	/** "<term>:<value>": diet:vegetarian, excludes:meat, freeFrom:LACTOSE, origin:fi, labels:EU_ORGANIC_FARMING. */
	requirement: z.string(),
	/** Who asked for it: the need (a request or a chef), the dish's diet codes, or the kitchen's own constraints. */
	from: z.enum(['need', 'kitchen', 'dish']),
	/** no: forbidden, never approvable. unknown: no record either way; held or rejected per unknownCounts, never ok. */
	verdict: z.enum(['no', 'unknown']),
	/** The product fact that decided it: "allergens list AM (milk)", "a meat product (category or name)", "origin se". */
	fact: z.string()
});
export type RequirementCheck = z.infer<typeof RequirementCheck>;
export type NeedRequirements = z.infer<typeof NeedRequirements>;

/** The ask behind a need, as stated (D18). */
export const NeedAsk = z.object({
	/** The words it came from ("250 ml laktoositonta maitoa", "4 packs lactose-free milk"). */
	words: z.string().max(300).optional(),
	qty: z.number().nonnegative().nullable(),
	unit: z.union([
		z.enum(['g', 'kg', 'ml', 'cl', 'dl', 'l', 'pcs', 'pack', 'case', 'sales_unit']),
		z.object({ unknown: z.string().max(40) })
	])
});
export type NeedAsk = z.infer<typeof NeedAsk>;

export const Need = z.object({
	id: z.string(),
	label: z.string(),
	/**
	 * `dish`: a served amount per guest (seeded or proposed menu). `direct`: a physical amount someone asked for
	 * ("1 l lactose-free milk"); substitutes are sized to `amount`, not to the original product's sales units.
	 * Absent on plans stored before this field existed: read as `dish` when `dish` is set, else `direct`.
	 */
	kind: z.enum(['dish', 'direct', 'sales']).optional(),
	/**
	 * D18: the ask as stated, so no entry can turn it into something else. `sales`-kind needs (packs, cases, the
	 * product's sales units, content per unit unknown) carry the asked count here; their `amount` is that count in
	 * `pcs` of sales units. An explicit unit nobody recognises stays `{ unknown: token }`: the entry asks first.
	 */
	ask: NeedAsk.optional(),
	/**
	 * Requirement lineage for needs planned from a menu proposal: which revision, dish and ingredient this need serves.
	 * Edits, substitutes and the Why chain follow these ids, never a label or an array position.
	 */
	source: z
		.object({
			proposalId: z.string(),
			revision: z.int().nonnegative(),
			dishId: z.string(),
			ingredientId: z.string()
		})
		.optional(),
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
	/**
	 * Why nothing can be bought for this need yet (a menu ingredient with no product, or one whose pack content is
	 * unknown). Shown to the chef as a gap, never dropped and never guessed.
	 */
	unresolved: z.string().max(300).optional(),
	/** Hard requirements every line serving this need must meet. */
	requirements: NeedRequirements.optional(),
	/** Where the requirements came from: the dish's diet codes, the request's words, or the chef. */
	requirementsFrom: z.enum(['dish', 'request', 'chef']).optional(),
	provenance: Provenance
});
export type Need = z.infer<typeof Need>;

/**
 * How sure the supply behind a candidate is (D8). Ranking is lexicographic on this tier first, then on the weighted
 * score: `known_stock` and `make_in_house` from known-stock ingredients beat `unknown_stock` (Terminal, 999999) and
 * `none`. Named for observed stock before commitment: "confirmed" is reserved for receipt-backed supply. Unknown candidates stay visible and labelled; they are never recommended over confirmed ones.
 */
export const SupplyTier = z.enum(['known_stock', 'make_in_house', 'unknown_stock', 'none']);
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
 * Server-derived read model for one line: what the UI may do with it, so clients never
 * infer it from state + reasons. Computed at read time (it depends on the live approval), never stored.
 */
export const LineView = z.object({
	/** Held for a reason a human may accept: it belongs in the approval. */
	reviewable: z.boolean(),
	/** Can be committed now: in the mandate, or covered by a granted approval, and nothing blocks it. */
	committable: z.boolean(),
	/**
	 * Quantity Valio states stock for (sales units; kg for KG-sold products). Known stock is not supplier-confirmed:
	 * only a receipt confirms (FulfilmentView.supplierConfirmed) (D10).
	 */
	knownStockCover: Measure,
	/** Quantity ordered or to be ordered whose supply is unknown (Terminal), never counted as cover. */
	unknownStockCover: Measure,
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
		/** Closed only because its cut-off passed: a later delivery date reopens it, a substitute would not. */
		'change_date',
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
	/** Which requirements the product misses, and the fact behind each (with requirement_unmet / requirement_unknown). */
	unmet: z.array(RequirementCheck).optional(),
	/** Terms the line was quoted on; null until quoted. */
	offer: Offer.nullable(),
	lineCents: Cents.nullable(),
	/** How much of the need this line covers, and what is left. */
	covers: Measure.optional(),
	residual: Measure.optional(),
	/** Present when this line replaces another product. */
	substituteFor: ProductId.optional(),
	/**
	 * The fulfilment strategy this line belongs to. A need has one active strategy; its lines are AND (all of a
	 * make-in-house recipe's ingredients are required), while different strategies are OR alternatives. Changing the
	 * strategy supersedes its uncommitted lines and voids affected approvals. Absent on lines of older plans (= buy).
	 */
	strategy: z
		.object({ id: z.string(), kind: z.enum(['buy', 'make_in_house', 'substitute']) })
		.optional(),
	score: ScoreBreakdown.optional(),
	/** Read model, filled on tool outputs (see LineView). */
	view: LineView.optional(),
	/** Origin of the line: the event seed, the agent, a chef edit, an external client. */
	provenance: Provenance
});
export type Line = z.infer<typeof Line>;

/**
 * Server-derived coverage of one need: the one definition of "covered" that Kitchen, Ops,
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
	/**
	 * What the amounts measure. `served`: a dish need with a yield, in what reaches the plate (purchase × yield), so a
	 * ready-cooked substitute and a raw original compare on what they serve (ham: 27 kg raw on the bone = 18.9 kg
	 * served). `purchase` (or absent): the need's own unit as bought. UIs label served amounts "kg served".
	 */
	basis: z.enum(['served', 'purchase']).optional(),
	/** The dish yield the served amounts were derived with (served = purchased × yield). */
	yield: z.number().positive().optional(),
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

/**
 * Which door started a plan, set by the server where that door builds its call context (never a tool input, so no
 * caller labels its own order): the kitchen's event plan, a usual order, /request, chat, an outside agent (MCP or
 * REST), or a reviewed menu. Absent on plans stored before it existed.
 */
export const PlanOrigin = z.enum(['event', 'usual', 'request', 'chat', 'agent', 'menu']);
export type PlanOrigin = z.infer<typeof PlanOrigin>;

export const Plan = z.object({
	...Scope.shape,
	id: z.string(),
	kitchenId: KitchenId,
	/** Bumped on every change; approvals and commits name the version they saw (STALE_VERSION otherwise). */
	version: z.int().nonnegative(),
	state: PlanState,
	deliverBy: IsoDate,
	eventId: z.string().optional(),
	/** The procurement task this plan serves, when it was created for one. */
	taskId: z.string().optional(),
	/** The chef-reviewed menu proposal revision this plan was built from. */
	source: z.object({ proposalId: z.string(), revision: z.int().nonnegative() }).optional(),
	/**
	 * Order-scope hard requirements ("everything Finnish", "all organic"): they apply to every line beside each need's
	 * own, and only ever tighten (a kitchen rule is never loosened by an order or a line).
	 */
	requirements: NeedRequirements.optional(),
	needs: z.array(Need),
	lines: z.array(Line),
	totalCents: Cents.nullable(),
	/** sha-256 over the canonical serialisation of the quoted lines (see core/hash.ts). */
	termsHash: z.string().nullable(),
	createdBy: Actor,
	/** Which door started it (server-set; see PlanOrigin). */
	origin: PlanOrigin.optional(),
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
	reason: z.string().optional(),
	/**
	 * What the approval was bound to when it was shown: the plan's lines and needs at `planVersion`. Kept so a voided
	 * approval can say what changed (get_plan.lastVoided) without reading the op log. Absent on older approvals.
	 */
	bound: z
		.object({
			lines: z.array(
				z.object({
					lineId: z.string(),
					productId: ProductId,
					productName: z.string().optional(),
					qty: SalesQty,
					unitCents: Cents.nullable(),
					state: LineState
				})
			),
			needs: z.array(z.object({ needId: z.string(), amount: Measure })).optional()
		})
		.optional()
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
		z.object({
			productId: ProductId,
			qty: SalesQty,
			lotId: z.string().optional(),
			/** The immutable order line this confirms, so allocation joins by identity, never by product. */
			lineId: z.string().optional()
		})
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
