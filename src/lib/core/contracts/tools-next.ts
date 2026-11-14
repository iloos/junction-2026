import { z } from 'zod';
import { Measure, ProductId, Provenance } from './primitives';
import { ResultMeta } from './tools';

/**
 * Tools agreed at T0 whose handlers are being built in Track D (web). The lead moves each
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
