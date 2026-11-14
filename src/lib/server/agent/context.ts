import type { Kitchen, Plan } from '$lib/core/contracts';
import buffet from '../../../../fixtures/seeds/christmas-buffet-140.json';
import { planName } from './plan-name';
import { INTENT_KINDS, type AgentContext, type PlanPick, type RunPrincipal } from './types';

/**
 * Read-only view of the workspace the context bootstrap needs. The server builds it from the store;
 * tests build it from a fresh PGlite. It never writes.
 */
export interface ContextSource {
	kitchens(workspaceId: string): Promise<Kitchen[]>;
	plans(workspaceId: string, runId: string): Promise<Plan[]>;
	/** Scenario date, YYYY-MM-DD. */
	today(): string;
	/** Scenario-clock now, ISO; offer cut-offs are compared with it. */
	now?(): string;
	/** The surface's default kitchen (the /request page's), if it has one. */
	defaultKitchenId?: string;
}

/** Events the fixture data can expand. Only seeded events are supported; others are `unsupported`. */
export const SUPPORTED_EVENTS: AgentContext['supportedEvents'] = [
	{ id: buffet.id, kitchenId: buffet.kitchenId, title: buffet.title }
];

export const KITCHEN_RE = /\bk-[a-z]+\b/i;
export const SHORTAGE_RE =
	/\b(shortage|shortages|short|out of stock|outage|outages|unavailable|substitut\w*|replace\w*|rescue|repair|loppu\w*|puuttu\w*|korvaa\w*)\b/i;

/** Whether a goal names a seeded event: its id, or a word of its title ("xmas", "joulu" for Christmas). */
export function eventMatches(goal: string, title: string, id: string): boolean {
	const g = goal.toLowerCase();
	if (g.includes(id)) return true;
	if (/christmas|joulu/i.test(title) && /\b(christmas|xmas|joulu\w*|pikkujoulu\w*)\b/i.test(g))
		return true;
	return false;
}

/**
 * The plan a request is about: the one the task (or an answered slot) names, else picked by what the request says, never by "event plans first" or by
 * version: a plan id it names, then a seeded event it names, then a kitchen it names, then (for a
 * shortage request) the plans with unorderable lines. Exactly one candidate left is the plan; several
 * mean the request does not say, and the caller asks which.
 */
export function pickPlan(
	goal: string,
	open: Plan[],
	planId?: string
): { plan: Plan; pickedBy: PlanPick } | null {
	const g = goal.toLowerCase();
	const one = (ps: Plan[], pickedBy: PlanPick) =>
		ps.length === 1 ? { plan: ps[0], pickedBy } : null;
	// A plan the task holds or the chef picked as an answer beats anything the words suggest.
	if (planId)
		return one(
			open.filter((p) => p.id === planId),
			'task'
		);
	const named = open.filter((p) => g.includes(p.id.toLowerCase()));
	if (named.length) return one(named, 'named');
	const event = SUPPORTED_EVENTS.find((e) => eventMatches(goal, e.title, e.id));
	if (event)
		return one(
			open.filter((p) => p.eventId === event.id),
			'event'
		);
	let pool = open;
	let pickedBy: PlanPick = 'only';
	const kitchen = goal.match(KITCHEN_RE)?.[0]?.toLowerCase();
	if (kitchen) {
		pool = pool.filter((p) => p.kitchenId === kitchen);
		pickedBy = 'kitchen';
	}
	if (pool.length > 1 && SHORTAGE_RE.test(goal)) {
		const short = pool.filter((p) => p.lines.some((l) => l.state === 'unorderable'));
		if (short.length) {
			pool = short;
			pickedBy = 'shortage';
		}
	}
	return one(pool, pickedBy);
}

/**
 * The small context the planner may read: authorized kitchens, the plan the request is about, the open
 * plans and what the agent supports. Kitchens outside `principal.kitchenIds` are left out, so the
 * planner never sees them.
 */
export async function bootstrapContext(
	source: ContextSource,
	principal: Pick<RunPrincipal, 'workspaceId' | 'runId' | 'kitchenIds'>,
	goal = '',
	/** The plan the task or an answered `plan` slot names. */
	planId?: string
): Promise<AgentContext> {
	const grant = principal.kitchenIds ? new Set(principal.kitchenIds) : null;
	const allowed = (id: string) => !grant || grant.has(id);
	// Kitchens first: the store creates a workspace on its first kitchens read.
	const kitchens = await source.kitchens(principal.workspaceId);
	const plans = await source.plans(principal.workspaceId, principal.runId);
	const open = plans.filter((p) => allowed(p.kitchenId) && p.state !== 'committed');
	const picked = pickPlan(goal, open, planId);
	return {
		kitchens: kitchens.filter((k) => allowed(k.id)).map((k) => ({ id: k.id, name: k.name })),
		currentPlan: picked
			? {
					id: picked.plan.id,
					version: picked.plan.version,
					state: picked.plan.state,
					kitchenId: picked.plan.kitchenId,
					...(picked.plan.eventId ? { eventId: picked.plan.eventId } : {}),
					pickedBy: picked.pickedBy
				}
			: null,
		openPlans: open.slice(-10).map((p) => ({
			id: p.id,
			name: planName(p, SUPPORTED_EVENTS),
			kitchenId: p.kitchenId,
			...(p.eventId ? { eventId: p.eventId } : {}),
			state: p.state
		})),
		supportedEvents: SUPPORTED_EVENTS.filter((e) => allowed(e.kitchenId)),
		supportedIntents: INTENT_KINDS.filter((k) => k !== 'unsupported'),
		...(source.defaultKitchenId &&
		kitchens.some((k) => k.id === source.defaultKitchenId && allowed(k.id))
			? { defaultKitchenId: source.defaultKitchenId }
			: {}),
		today: source.today(),
		...(source.now ? { now: source.now() } : {})
	};
}
