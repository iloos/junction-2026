import { z } from 'zod';
import { EventBrief, MenuProposal } from './event';
import { TaskLedger } from './task';
import { ResultMeta } from './tools';

/**
 * Tools agreed in T1 (Ring 2) whose handlers are being built. The lead moves each into `toolSchemas` in the merge
 * that lands its handler, so the registry never advertises a tool that can't run.
 */
export const plannedToolSchemas = {
	get_outcome: {
		scope: 'read',
		description:
			"What is true for a plan or task now, in numbers: per need supplier confirmed / awaiting supplier / planned / unresolved, money committed, receipts, decisions left and the next action. Use it to report outcomes; don't infer them.",
		input: z
			.object({ planId: z.string().optional(), taskId: z.string().optional() })
			.refine(
				(v) => (v.planId === undefined) !== (v.taskId === undefined),
				'give planId or taskId'
			),
		output: z.object({ ledger: TaskLedger, meta: ResultMeta.optional() })
	},
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
