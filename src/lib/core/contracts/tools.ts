import { z } from 'zod';
import { ApprovalState, Line, Plan, ScoreBreakdown } from './plan';
import { Offer, Product } from './product';
import { IsoDate, KitchenId, Measure, ProductId, SalesQty } from './primitives';

/**
 * One tool registry, exposed three ways: MCP (`/mcp`), REST (`/api/tools/<name>`) and OpenAPI (`/api/openapi.json`).
 * The same definitions feed the internal agent loop. Inputs/outputs here are the contract; handlers live server-side.
 */

/** Credential scopes. The external client never gets `approve` or `mandate:write` (eval s5). */
export const ToolScope = z.enum(['read', 'plan', 'order', 'approve', 'mandate:write']);
export type ToolScope = z.infer<typeof ToolScope>;

export const SCOPES_BY_ACTOR = {
	chef: ['read', 'plan', 'order', 'approve', 'mandate:write'],
	kitchen_agent: ['read', 'plan', 'order'],
	external_agent: ['read', 'plan', 'order'],
	approver: ['read', 'approve'],
	system: ['read', 'plan', 'order'],
	job: ['read']
} as const satisfies Record<string, readonly ToolScope[]>;

const PlanRef = z.object({ planId: z.string(), version: z.int().nonnegative() });

export const toolSchemas = {
	search_products: {
		scope: 'read',
		description: 'Search the static catalogue (no Valio call). Returns products with provenance.',
		input: z.object({ query: z.string().min(1), limit: z.int().min(1).max(50).default(10) }),
		output: z.object({ products: z.array(Product) })
	},
	quote: {
		scope: 'read',
		description:
			'Live price and availability for up to 200 known product ids (cache-through). Unknown ids return NOT_FOUND and never reach Valio.',
		input: z.object({
			productIds: z.array(ProductId).min(1).max(200),
			deliverBy: IsoDate.optional()
		}),
		output: z.object({ offers: z.array(Offer), notFound: z.array(z.string()) })
	},
	plan_event: {
		scope: 'plan',
		description:
			'Expand an event (menu × covers) into a plan with needs, lines, rounding and anomalies.',
		input: z.object({ kitchenId: KitchenId, eventId: z.string() }),
		output: z.object({ plan: Plan })
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
					z.object({ productId: ProductId, qty: SalesQty.shape.value, unit: SalesQty.shape.unit })
				)
				.min(1)
		}),
		output: z.object({ plan: Plan, approvalId: z.string().nullable() })
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
		output: z.object({ plan: Plan })
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
			requireOrigin: z.string().length(2).optional()
		}),
		output: z.object({
			plan: Plan,
			kind: z.enum(['product', 'make_in_house', 'none']),
			chosen: z.array(Line),
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
		output: z.object({
			plan: Plan,
			/** The current approval for the plan (newest pending/granted), with what it is bound to. */
			approval: z
				.object({
					id: z.string(),
					state: ApprovalState,
					planVersion: z.int(),
					termsHash: z.string(),
					lineIds: z.array(z.string()),
					tier: z.enum(['act', 'propose', 'sign_off'])
				})
				.nullable()
		})
	},
	explain_line: {
		scope: 'read',
		description: 'The Why drawer for one line: ordered steps with sources.',
		input: z.object({ planId: z.string(), lineId: z.string() }),
		output: z.object({
			steps: z.array(
				z.object({ text: z.string(), source: z.string(), detail: z.string().optional() })
			)
		})
	},
	approve: {
		scope: 'approve',
		description: 'Grant or deny an approval bound to the exact plan version and terms hash shown.',
		input: z.object({
			approvalId: z.string(),
			planVersion: z.int().nonnegative(),
			termsHash: z.string(),
			decision: z.enum(['grant', 'deny'])
		}),
		output: z.object({ state: ApprovalState })
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
		output: z.object({
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
		output: z.object({ mandateVersion: z.int() })
	}
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
export type ToolInput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]['output']>;
