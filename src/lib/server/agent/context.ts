import type { Kitchen, Plan } from '$lib/core/contracts';
import buffet from '../../../../fixtures/seeds/christmas-buffet-140.json';
import { INTENT_KINDS, type AgentContext, type RunPrincipal } from './types';

/**
 * Read-only view of the workspace the context bootstrap needs. The server builds it from the store;
 * tests build it from a fresh PGlite. It never writes.
 */
export interface ContextSource {
	kitchens(workspaceId: string): Promise<Kitchen[]>;
	plans(workspaceId: string, runId: string): Promise<Plan[]>;
	/** Scenario date, YYYY-MM-DD. */
	today(): string;
}

/** Events the fixture data can expand. Only seeded events are supported; others are `unsupported`. */
export const SUPPORTED_EVENTS: AgentContext['supportedEvents'] = [
	{ id: buffet.id, kitchenId: buffet.kitchenId, title: buffet.title }
];

/**
 * The small context the planner may read: authorized kitchens, the current plan and what the agent
 * supports. Kitchens outside `principal.kitchenIds` are left out, so the planner never sees them.
 */
export async function bootstrapContext(
	source: ContextSource,
	principal: Pick<RunPrincipal, 'workspaceId' | 'runId' | 'kitchenIds'>
): Promise<AgentContext> {
	const grant = principal.kitchenIds ? new Set(principal.kitchenIds) : null;
	const allowed = (id: string) => !grant || grant.has(id);
	// Kitchens first: the store creates a workspace on its first kitchens read.
	const kitchens = await source.kitchens(principal.workspaceId);
	const plans = await source.plans(principal.workspaceId, principal.runId);
	const mine = plans.filter((p) => allowed(p.kitchenId) && p.state !== 'committed');
	// Event plans first (the stage plan), then the newest by version.
	const current =
		mine.find((p) => p.eventId) ?? [...mine].sort((a, b) => b.version - a.version)[0] ?? null;
	return {
		kitchens: kitchens.filter((k) => allowed(k.id)).map((k) => ({ id: k.id, name: k.name })),
		currentPlan: current
			? {
					id: current.id,
					version: current.version,
					state: current.state,
					kitchenId: current.kitchenId
				}
			: null,
		supportedEvents: SUPPORTED_EVENTS.filter((e) => allowed(e.kitchenId)),
		supportedIntents: INTENT_KINDS.filter((k) => k !== 'unsupported'),
		today: source.today()
	};
}
