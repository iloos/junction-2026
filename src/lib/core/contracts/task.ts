import { z } from 'zod';
import { Actor, Cents, IsoDateTime, KitchenId, Measure, Scope } from './primitives';

/**
 * A procurement task: the durable user objective ("Christmas buffet for 140", "1,000 l lactose-free milk by
 * Thursday") that requests, menu proposals, plans, decisions, agent runs and receipts hang off. Distinct from a
 * scenario run (a resettable demo context) and an agent run (one bounded execution). The chat, the Kitchen task page
 * and Ops all open a task; a turn reads the task to know which plan it is about, never a transcript.
 *
 * Only the server writes a task. The ledger is recomputed from get_plan (FulfilmentView) and receipts after every
 * change; a model never writes it.
 */

export const TaskState = z.enum([
	'open',
	'running',
	'awaiting_clarification',
	'awaiting_chef',
	'awaiting_supplier',
	'done',
	'cancelled',
	'failed'
]);
export type TaskState = z.infer<typeof TaskState>;

/** What a clarification may ask for: typed slots, so an answer can never change the meaning of the rest. */
export const ClarifyField = z.enum([
	'kitchen',
	'plan',
	'qty',
	'unit',
	'date',
	'dish',
	'guests',
	'product',
	'dietary',
	'budget'
]);
export type ClarifyField = z.infer<typeof ClarifyField>;

export const TaskPending = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('clarify'),
		field: ClarifyField,
		/** Our own words. */
		question: z.string().max(300),
		options: z.array(z.object({ label: z.string().max(80), value: z.string().max(200) })).max(6)
	}),
	z.object({
		kind: z.literal('decision'),
		approvalId: z.string(),
		planId: z.string(),
		planVersion: z.int().nonnegative(),
		termsHash: z.string(),
		groups: z.array(
			z.object({ reason: z.string(), lineIds: z.array(z.string()), totalCents: Cents })
		),
		/** Where a human approves (Kitchen deep link). Locates, never authorises. */
		approvalUrl: z.string()
	}),
	z.object({ kind: z.literal('none') })
]);
export type TaskPending = z.infer<typeof TaskPending>;

/** One need's position in the D10 partition, copied from FulfilmentView at `asOf`. */
export const TaskLedgerNeed = z.object({
	needId: z.string(),
	planId: z.string(),
	label: z.string(),
	required: Measure,
	supplierConfirmed: Measure,
	awaitingSupplier: Measure,
	plannedKnown: Measure,
	plannedUnknown: Measure,
	unresolved: Measure,
	excess: Measure
});
export type TaskLedgerNeed = z.infer<typeof TaskLedgerNeed>;

/** What is true for the task now, in numbers. Every claim a summary makes must be backed by a field here. */
export const TaskLedger = z.object({
	asOf: IsoDateTime,
	validUntil: IsoDateTime.optional(),
	needs: z.array(TaskLedgerNeed),
	committedCents: Cents,
	receiptIds: z.array(z.string()),
	/** Decisions a human still has to make (reason groups across the task's plans). */
	decisionsLeft: z.int().nonnegative(),
	/** Our own words, derived from typed state (one `nextActionFor` rule). */
	nextAction: z.string().max(200)
});
export type TaskLedger = z.infer<typeof TaskLedger>;

export const Task = z.object({
	...Scope.shape,
	id: z.string().min(1).max(64),
	kitchenId: KitchenId,
	title: z.string().max(200),
	createdBy: Actor,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	/** Bumped on every write; writers compare-and-set on it. */
	version: z.int().nonnegative(),
	/** The request as typed intent: "what", not the transcript. Shape owned by the agent lane. */
	requirement: z.record(z.string(), z.unknown()),
	/** Answered clarifications by field. */
	slots: z.partialRecord(ClarifyField, z.unknown()),
	plans: z.array(
		z.object({
			planId: z.string(),
			versionSeen: z.int().nonnegative(),
			role: z.enum(['primary', 'touched'])
		})
	),
	proposal: z.object({ id: z.string(), revision: z.int().nonnegative() }).optional(),
	/** Agent runs on this task, newest last (capped at 20). */
	runs: z
		.array(
			z.object({
				agentRunId: z.string(),
				turn: z.int().nonnegative(),
				intent: z.string(),
				stopped: z.string(),
				at: IsoDateTime
			})
		)
		.max(20),
	pending: TaskPending,
	state: TaskState,
	ledger: TaskLedger.optional()
});
export type Task = z.infer<typeof Task>;

/**
 * Trace shape for every call to an outside service (Valio, Gemini, Exa, Context.dev, embeddings), so the trace
 * drawer and an Ops cost view read one format. `cache` says honestly where the answer came from.
 */
export const ExternalCallTrace = z.object({
	api: z.enum(['valio', 'gemini', 'exa', 'contextdev', 'featherless', 'other']),
	/** What the call was for, e.g. 'offers', 'decide.fit', 'menu.propose', 'lookup_facts'. */
	purpose: z.string().max(80),
	cache: z.enum(['live', 'cache', 'replay', 'fixture']),
	ok: z.boolean(),
	latencyMs: z.number().nonnegative(),
	/** Provider units where known (tokens, credits, ids requested). */
	costUnits: z.number().nonnegative().optional(),
	model: z.string().optional(),
	workspaceId: z.string().optional(),
	error: z.string().max(300).optional()
});
export type ExternalCallTrace = z.infer<typeof ExternalCallTrace>;
