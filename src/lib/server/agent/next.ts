import type { Plan } from '$lib/core/contracts';
import { nextActionFor, type NextAction } from '$lib/core/mandate/next';

/**
 * Core's one next-action rule for a plan, as of the instant its read model was computed (`view.asOf`, the scenario
 * clock), so the words agree with the line views they are read from. A plan without a view reads as of `now`.
 */
export function nextFor(plan: Plan, now: Date = new Date()): NextAction {
	return nextActionFor(plan, plan.view?.asOf ? new Date(plan.view.asOf) : now);
}

/** The tool a client would call for that action, when there is one. */
export function nextTool(
	plan: Plan,
	n: NextAction
): { tool: string; args: Record<string, unknown> } | null {
	switch (n.action) {
		case 'find_substitute':
			return {
				tool: 'find_substitutes',
				args: { planId: plan.id, version: plan.version, lineId: n.lineIds[0] }
			};
		case 'commit':
			return { tool: 'commit_order', args: { planId: plan.id, version: plan.version } };
		case 'approve':
		case 'resolve_rule':
		case 'resolve_need':
			return { tool: 'get_plan', args: { planId: plan.id } };
		default:
			return null;
	}
}
