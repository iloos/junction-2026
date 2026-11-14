import { z } from 'zod';
import { KitchenId, Measure, ProductId, Provenance } from './primitives';
import { ResultMeta } from './tools';

/**
 * Tools agreed at T0 whose handlers are being built in Track D (web) and Track E (agent door). The lead moves each
 * into `toolSchemas` in the same merge that lands its handler, so the registry never lists a tool that can't run.
 * Same shape rules as `toolSchemas`: scope, our own description, input, output with optional `meta`.
 */

/** A web-sourced fact: never overwrites a catalogue fact; shown with its sources. */
export const WebFact = z.object({
	field: z.string(),
	value: z.unknown(),
	/** True only when a source cites this product's own GTIN (not a name match). */
	gtinCited: z.boolean(),
	sources: z.array(z.object({ url: z.string(), title: z.string().optional() })).max(10),
	provenance: Provenance
});
export type WebFact = z.infer<typeof WebFact>;

export const plannedToolSchemas = {
	get_context: {
		scope: 'read',
		description:
			'Start here: who you are, which kitchens and events you may plan for, your scopes, the scenario date and cut-off, and the open plans with their next action.',
		input: z.object({}),
		output: z.object({
			actor: z.object({ kind: z.string(), id: z.string() }),
			scopes: z.array(z.string()),
			workspaceId: z.string(),
			scenario: z.object({ now: z.string(), cutoff: z.string(), delivery: z.string() }),
			kitchens: z.array(
				z.object({
					id: KitchenId,
					name: z.string(),
					events: z.array(z.object({ id: z.string(), title: z.string() }))
				})
			),
			openPlans: z.array(
				z.object({
					planId: z.string(),
					version: z.int(),
					state: z.string(),
					nextAction: z.string()
				})
			),
			meta: ResultMeta.optional()
		})
	},
	lookup_facts: {
		scope: 'read',
		description:
			'Look up facts about a catalogue product on the web (Exa), with cited sources. Read-only: it records nothing on the plan or the product (catalogue facts win), and each uncached lookup counts against your daily web budget.',
		input: z.object({ productId: ProductId, question: z.string().max(200).optional() }),
		output: z.object({ facts: z.array(WebFact), cached: z.boolean(), meta: ResultMeta.optional() })
	},
	find_outside: {
		scope: 'read',
		description:
			'Find options outside the Valio catalogue for an unresolved need, with sources. Never ordered: information for the chef.',
		input: z.object({ need: z.string().max(200), amount: Measure.optional() }),
		output: z.object({
			options: z.array(
				z.object({
					title: z.string(),
					url: z.string(),
					note: z.string().optional(),
					provenance: Provenance
				})
			),
			meta: ResultMeta.optional()
		})
	},
	check_recall: {
		scope: 'read',
		description:
			'Check the watched recall notices (Context.dev monitor) against a product; says whether a notice cites it by GTIN or only by name.',
		input: z.object({ productId: ProductId }),
		output: z.object({
			notices: z.array(
				z.object({
					url: z.string(),
					title: z.string(),
					match: z.enum(['gtin', 'name', 'none']),
					drill: z.boolean(),
					seenAt: z.string()
				})
			),
			meta: ResultMeta.optional()
		})
	}
} as const;
