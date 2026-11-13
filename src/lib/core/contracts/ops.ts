import { z } from 'zod';
import { DomainError } from './errors';
import { Offer } from './product';
import { Approval, Anomaly, Line, Order, Plan, PlanState, Receipt, ScoreBreakdown } from './plan';
import { Actor, Cents, IsoDateTime, ProductId, Provenance, Scope } from './primitives';

/**
 * The closed op union (D6). Every state change is one of these, reduced by the pure `applyOps`
 * and persisted with the new state in one transaction by the server command handler.
 * Ops that touch a plan name the `baseVersion` they were computed against.
 */
export const CreatePlan = z.object({ type: z.literal('CreatePlan'), plan: Plan });

export const EditLine = z.object({
	type: z.literal('EditLine'),
	planId: z.string(),
	baseVersion: z.int().nonnegative(),
	lineId: z.string(),
	/** The line after the edit; null removes it. */
	line: Line.nullable(),
	/** What the chef or agent changed, for the op log ("g/guest 135 → 120"). */
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
	/** The chosen replacement line (held or eligible by tier), or null when nothing qualifies. */
	line: Line.nullable(),
	/** Every candidate considered, ranked, with exclusions: the Why drawer reads this. */
	candidates: z.array(
		z.object({
			productId: ProductId,
			rank: z.int().positive().nullable(),
			score: ScoreBreakdown.optional(),
			rejectedReasons: z.array(z.string()),
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

export const Op = z.discriminatedUnion('type', [
	CreatePlan,
	EditLine,
	RecordOffer,
	ProposeSubstitute,
	RecordApproval,
	CommitOrder,
	RecordAnomaly,
	RecordEnrichment
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
	idempotencyKey: z.string().optional(),
	op: Op
});
export type OpEnvelope = z.infer<typeof OpEnvelope>;

/** An op before the store assigns seq and timestamp. */
export type PendingOp = Omit<OpEnvelope, 'seq' | 'at'>;
