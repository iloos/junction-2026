import { z } from 'zod';
import { ApprovalState, Line, Plan, ScoreBreakdown, TermsDiff } from './plan';
import { Offer, Product } from './product';
import { IsoDate, KitchenId, Measure, ProductId, SalesQty } from './primitives';

/**
 * One tool registry, exposed three ways: MCP (`/mcp`), REST (`/api/tools/<name>`) and OpenAPI (`/api/openapi.json`).
 * The same definitions feed the internal agent loop. Inputs/outputs here are the contract; handlers live server-side.
 */

/** Credential scopes. The external client never gets `approve` or `mandate:write` (eval s5). */
export const ToolScope = z.enum(['read', 'plan', 'order', 'approve', 'mandate:write', 'agent:run']);
export type ToolScope = z.infer<typeof ToolScope>;

export const SCOPES_BY_ACTOR = {
	chef: ['read', 'plan', 'order', 'approve', 'mandate:write', 'agent:run'],
	kitchen_agent: ['read', 'plan', 'order'],
	external_agent: ['read', 'plan', 'order'],
	approver: ['read', 'approve'],
	system: ['read', 'plan', 'order'],
	job: ['read']
} as const satisfies Record<string, readonly ToolScope[]>;

const PlanRef = z.object({ planId: z.string(), version: z.int().nonnegative() });

/**
 * What a client (or a model) should understand from a result without parsing it: one sentence, the next tool to
 * call, and where a human approves. Always our own wording from typed fields, never supplier or web strings, so a
 * catalogue name can't inject instructions into an agent's context.
 */
export const ResultMeta = z.object({
	summary: z.string().max(400),
	nextAction: z
		.object({
			tool: z.string(),
			why: z.string().max(200),
			args: z.record(z.string(), z.unknown()).optional()
		})
		.optional(),
	/** Deep link to the exact plan in the Kitchen screen, for a human approver. */
	approvalUrl: z.string().optional()
});
export type ResultMeta = z.infer<typeof ResultMeta>;

/** Every tool output carries an optional `meta` (ResultMeta). */
const out = <S extends z.ZodRawShape>(shape: S) =>
	z.object({ ...shape, meta: ResultMeta.optional() });

/**
 * plan_event: a seeded event by id, or a menu proposal revision the server stored and a chef reviewed (exactly one).
 * The caller names the revision; the server checks its stored review record (who, when, digest), so a client can't
 * establish a chef review by sending a status. Planning from it is deterministic and never calls a model.
 */
const PlanEventInput = z
	.object({
		kitchenId: KitchenId,
		eventId: z.string().optional(),
		proposal: z.object({ id: z.string(), revision: z.int().nonnegative() }).optional()
	})
	.refine(
		(v) => (v.eventId !== undefined) !== (v.proposal !== undefined),
		'give either eventId or a reviewed menu proposal {id, revision}'
	);

export const toolSchemas = {
	search_products: {
		scope: 'read',
		description: 'Search the static catalogue (no Valio call). Returns products with provenance.',
		input: z.object({ query: z.string().min(1), limit: z.int().min(1).max(50).default(10) }),
		output: out({ products: z.array(Product) })
	},
	quote: {
		scope: 'read',
		description:
			'Live price and availability for up to 200 known product ids (cache-through). Unknown ids return NOT_FOUND and never reach Valio.',
		input: z.object({
			productIds: z.array(ProductId).min(1).max(200),
			deliverBy: IsoDate.optional()
		}),
		output: out({ offers: z.array(Offer), notFound: z.array(z.string()) })
	},
	plan_event: {
		scope: 'plan',
		description:
			'Expand an event (menu × covers) into a plan with needs, lines, rounding and anomalies. Give a seeded eventId, or a chef-reviewed menu proposal (its estimates stay labelled as estimates).',
		input: PlanEventInput,
		output: out({ plan: Plan })
	},
	place_order: {
		scope: 'order',
		description:
			'Create and quote a plan from explicit lines. Idempotent per key; the same key with a different payload is DUPLICATE.',
		input: z.object({
			kitchenId: KitchenId,
			deliverBy: IsoDate,
			idempotencyKey: z.string().min(1).max(128),
			lines: z
				.array(
					z.object({
						productId: ProductId,
						qty: SalesQty.shape.value,
						unit: SalesQty.shape.unit,
						/**
						 * The physical amount behind `qty` when the caller asked in kg/l/pcs ("1 l milk"). It becomes a
						 * `direct` need, so a substitute is sized to it (1 l → 2 × 0.5 l), not to the sales-unit count.
						 * When given it is the demand authority: a `qty` that disagrees with the server's sizing of it
						 * is INVALID_INPUT (with the computed quantity), never silently preferred either way.
						 */
						amount: Measure.optional()
					})
				)
				.min(1)
		}),
		output: out({ plan: Plan, approvalId: z.string().nullable() })
	},
	edit_line: {
		scope: 'plan',
		description:
			'Change one line or need (qty, g/guest, product). Invalidates the quote and any approval.',
		input: PlanRef.extend({
			/** A line edit (qty, product) or a need edit (gramsPerGuest, which recomputes its lines). */
			lineId: z.string().optional(),
			needId: z.string().optional(),
			patch: z.object({
				qty: z.number().nonnegative().optional(),
				productId: ProductId.optional(),
				gramsPerGuest: z.number().nonnegative().optional()
			})
		}),
		output: out({ plan: Plan })
	},
	find_substitutes: {
		scope: 'plan',
		description:
			"Rank substitutes for a line under the kitchen's weights and rules: Valio's rules first, then domain search.",
		input: PlanRef.extend({
			lineId: z.string(),
			/** Rank under these weights instead of the kitchen's (the "Same shortage. Your rules." beat); not persisted. */
			weights: z.record(z.string(), z.number().min(0)).optional(),
			/** Extra origin requirement for this ranking only, e.g. "fi". */
			requireOrigin: z.string().length(2).optional(),
			/**
			 * Apply the recommendation to the plan: replaces the dish's current substitute and voids the approval.
			 * Default: apply when the dish has no substitute yet and no per-call rules are given; otherwise preview.
			 */
			apply: z.boolean().optional()
		}),
		output: out({
			plan: Plan,
			kind: z.enum(['product', 'make_in_house', 'none']),
			/** The current recommendation under the rules used (never a rejected candidate). */
			chosen: z.array(Line),
			/** Whether this call changed the plan. */
			applied: z.boolean(),
			/** The dish's substitute lines on the plan before this call (unchanged by a preview). */
			saved: z.array(Line),
			candidates: z.array(
				z.object({
					productId: ProductId,
					productName: z.string().optional(),
					rank: z.int().positive().nullable(),
					score: ScoreBreakdown.optional(),
					rejectedReasons: z.array(z.string()),
					fromValioRule: z.boolean()
				})
			),
			labourNote: z.string().optional(),
			residual: Measure.optional()
		})
	},
	get_plan: {
		scope: 'read',
		description: 'Current plan with lines, states, reasons and the approval state.',
		input: z.object({ planId: z.string() }),
		output: out({
			plan: Plan,
			/** The current approval for the plan (newest pending/granted), with what it is bound to. */
			approval: z
				.object({
					id: z.string(),
					state: ApprovalState,
					planVersion: z.int(),
					termsHash: z.string(),
					lineIds: z.array(z.string()),
					tier: z.enum(['act', 'propose', 'sign_off']),
					mandateVersion: z.int().optional(),
					expiresAt: z.string().optional(),
					requestedBy: z.object({ kind: z.string(), id: z.string() }).optional(),
					decidedBy: z.object({ kind: z.string(), id: z.string() }).optional()
				})
				.nullable(),
			/** The most recently voided approval and what changed since it was bound (the before → after diff). */
			lastVoided: z.object({ approvalId: z.string(), diff: TermsDiff }).nullable().optional()
		})
	},
	explain_line: {
		scope: 'read',
		description: 'The Why drawer for one line: ordered steps with sources.',
		input: z.object({ planId: z.string(), lineId: z.string() }),
		output: out({
			steps: z.array(
				z.object({ text: z.string(), source: z.string(), detail: z.string().optional() })
			)
		})
	},
	approve: {
		scope: 'approve',
		description:
			'Grant or deny an approval, or one reason group of it, bound to the exact plan version and terms hash shown.',
		input: z.object({
			approvalId: z.string(),
			planVersion: z.int().nonnegative(),
			termsHash: z.string(),
			decision: z.enum(['grant', 'deny']),
			/**
			 * Decide only these lines (one reason group, e.g. the allergen change) of a pending approval. Semantics:
			 * the approval splits: these lines keep this approval id and take the decision; the rest move to a new pending
			 * approval bound to the same plan version and terms (`remainingApprovalId`). Groups are decided one at a time.
			 * A denied group's lines can't commit; it doesn't void the other grants. Any plan change invalidates every
			 * approval of the plan. A commit is covered line by line by the granted approvals on the current terms, and
			 * each order line names the approval that covered it (`Order.lines[].authority`): no grant covers a line
			 * it did not list. Absent = decide every line of the approval at once (today's behaviour).
			 */
			lineIds: z
				.array(z.string())
				.min(1)
				.refine((ids) => new Set(ids).size === ids.length, 'lineIds must be unique')
				.optional()
		}),
		output: out({
			state: ApprovalState,
			/** The pending approval holding the lines this call did not decide; null when none remain. */
			remainingApprovalId: z.string().nullable().optional()
		})
	},
	commit_order: {
		scope: 'order',
		description:
			'Revalidate terms, check caps under lock, atomically consume simulated stock, write one order + receipt. Retrying the same key returns the same receipt.',
		input: PlanRef.extend({
			idempotencyKey: z.string().min(1).max(128),
			/** Default: every eligible line plus every line covered by a granted approval. */
			lineIds: z
				.array(z.string())
				.refine((ids) => new Set(ids).size === ids.length, 'lineIds must be unique')
				.optional()
		}),
		output: out({
			orderId: z.string(),
			receiptId: z.string(),
			totalCents: z.int(),
			committedLineIds: z.array(z.string()),
			awaitingSupplier: z.array(z.string())
		})
	},
	set_mandate: {
		scope: 'mandate:write',
		description:
			"Change the kitchen's mandate (caps, never-delegate list, weights). Bumps the mandate version.",
		input: z.object({
			kitchenId: KitchenId,
			lineCapCents: z.int().optional(),
			orderCapCents: z.int().optional(),
			weeklyCapCents: z.int().optional(),
			weights: z.record(z.string(), z.number()).optional()
		}),
		output: out({ mandateVersion: z.int() })
	}
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
export type ToolInput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]['output']>;
