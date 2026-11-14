import { z } from 'zod';
import { EventBrief, MenuProposal } from './event';
import { ResultMeta } from './tools';

/**
 * Tools agreed in T1 (Ring 2) whose handlers are being built. The lead moves each into `toolSchemas` in the merge
 * that lands its handler, so the registry never advertises a tool that can't run.
 */
export const plannedToolSchemas = {
	propose_menu: {
		scope: 'plan',
		description:
			'Propose a menu for an event brief: dishes with ingredient amounts per guest, each ingredient resolved to a catalogue product or left visibly unresolved. Estimates are labelled; a chef reviews the menu before it can be planned.',
		input: z.object({ kitchenId: z.string(), brief: EventBrief }),
		output: z.object({
			proposal: MenuProposal,
			issues: z.array(
				z.object({ id: z.string(), severity: z.enum(['block', 'warn']), text: z.string() })
			),
			meta: ResultMeta.optional()
		})
	}
} as const;
