import { z } from 'zod';
import { DomainError } from './errors';
import { Offer } from './product';
import {
	Approval,
	Anomaly,
	Line,
	Need,
	Order,
	Plan,
	PlanState,
	Receipt,
	ScoreBreakdown
} from './plan';
import { Actor, Cents, IsoDateTime, ProductId, Provenance, Scope } from './primitives';

/**
 * The closed op union (D6). Every state change is one of these, reduced by the pure `applyOps`
 * and persisted with the new state in one transaction by the server command handler.
 * Ops that touch a plan name the `baseVersion` they were computed against.
 */
export const CreatePlan = z.object({ type: z.literal('CreatePlan'), plan: Plan });

/**
 * A chef or agent edit: optionally a need (g/guest, covers) and the lines recomputed from it.
 * Committed lines can't be edited.
 */
export const EditLine = z.object({
	type: z.literal('EditLine'),
	planId: z.string(),
	baseVersion: z.int().nonnegative(),
	/** The need after the edit (replaces the need with the same id). */
	need: Need.optional(),
	/** Each line after the edit; `line: null` removes it; an unknown lineId adds it. */
	lines: z.array(z.object({ lineId: z.string(), line: Line.nullable() })),
	/** What changed, for the op log ("g/guest 135 → 120"). */
	summary: z.string()
});

/** A quote: live terms fetched and every line evaluated against the mandate. */
export const RecordOffer = z.object({
	type: z.literal('RecordOffer'),
	planId: z.string(),
	baseVersion: z.int().nonnegative(),
	offers: z.array(Offer),
	lines: z.array(Line),
	planState: PlanState,
	totalCents: Cents,
	termsHash: z.string()
});

export const ProposeSubstitute = z.object({
	type: z.literal('ProposeSubstitute'),
	planId: z.string(),
	baseVersion: z.int().nonnegative(),
	forLineId: z.string(),
	/** `product`: one replacement SKU. `make_in_house`: ingredient lines for a recipe (team estimate). */
	kind: z.enum(['product', 'make_in_house']),
	/** The chosen replacement line(s), held or eligible by tier; empty when nothing qualifies. */
	lines: z.array(Line),
	/** Labour/oven note for make-in-house ("~40 min prep, 2 h oven"). */
	labourNote: z.string().optional(),
	/** Every candidate considered, ranked, with exclusions: the Why drawer reads this. */
	candidates: z.array(
		z.object({
			productId: ProductId,
			rank: z.int().positive().nullable(),
			score: ScoreBreakdown.optional(),
			rejectedReasons: z.array(z.string()),
			/** A model caution in words (CAUTION.* in rejectedReasons): evidence for a human, never a rejection. */
			caution: z.string().max(400).optional(),
			fromValioRule: z.boolean()
		})
	)
});

/** Each approval transition is recorded as the full approval after the change. */
export const RecordApproval = z.object({ type: z.literal('RecordApproval'), approval: Approval });

export const CommitOrder = z.object({
	type: z.literal('CommitOrder'),
	outcome: z.discriminatedUnion('result', [
		z.object({ result: z.literal('committed'), order: Order, receipt: Receipt }),
		z.object({
			result: z.literal('failed'),
			planId: z.string(),
			idempotencyKey: z.string(),
			error: DomainError
		})
	])
});

export const RecordAnomaly = z.object({ type: z.literal('RecordAnomaly'), anomaly: Anomaly });

/** A derived product field from a job (Modal) or the agent. Stays a suggestion with provenance (D6). */
export const RecordEnrichment = z.object({
	type: z.literal('RecordEnrichment'),
	productId: ProductId,
	field: z.string(),
	value: z.unknown(),
	provenance: Provenance
});

/**
 * A tool call the gate refused (FORBIDDEN): an outside or kitchen agent asked for something its mandate or
 * scope does not allow. The envelope's actor is the refused caller. Recorded so the refusal is visible in the
 * op log; it never changes a plan, an approval or an order.
 */
export const RecordRefusal = z.object({
	type: z.literal('RecordRefusal'),
	tool: z.string(),
	code: DomainError.shape.code,
	sub: z.string().optional(),
	/** The gate's message, as the caller got it. */
	message: z.string(),
	planId: z.string().optional(),
	kitchenId: z.string().optional()
});

export const Op = z.discriminatedUnion('type', [
	CreatePlan,
	EditLine,
	RecordOffer,
	ProposeSubstitute,
	RecordApproval,
	CommitOrder,
	RecordAnomaly,
	RecordEnrichment,
	RecordRefusal
]);
export type Op = z.infer<typeof Op>;
export type OpType = Op['type'];

/** An op as stored in the log. `seq` is a per-workspace sequence allocated under lock (D6). */
export const OpEnvelope = z.object({
	...Scope.shape,
	seq: z.int().positive(),
	at: IsoDateTime,
	actor: Actor,
	/** Tool or route that produced it, e.g. "mcp:place_order". */
	via: z.string(),
	/** Who started the agent run that wrote this op, when it differs from `actor` (RunPrincipal). */
	initiatedBy: Actor.optional(),
	idempotencyKey: z.string().optional(),
	op: Op
});
export type OpEnvelope = z.infer<typeof OpEnvelope>;

/** An op before the store assigns seq and timestamp. */
export type PendingOp = Omit<OpEnvelope, 'seq' | 'at'>;
