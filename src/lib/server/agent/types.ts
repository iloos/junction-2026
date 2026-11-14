import type { Actor, ActorKind, ToolName } from '$lib/core/contracts';

/**
 * Agent-local types. RunPrincipal, GoalOutcome and the `agent:run` permission are candidates for
 * `src/lib/core/contracts` (see docs/lanes/agent2.md, Needs); until then they live here.
 */

/** Actor kinds that may start the routine agent (`agent:run`). Starting a run delegates purchasing work. */
export const AGENT_RUN_ACTORS: readonly ActorKind[] = ['chef'];

/**
 * Who a run acts for, built server-side when the run starts and never taken from a request body.
 * The agent writes as `serviceActor`; every op it writes also names `initiatedBy` (in `via`).
 * Effective scopes are the intersection of the initiator's and the service actor's.
 */
export interface RunPrincipal {
	initiatedBy: Actor;
	serviceActor: Actor;
	workspaceId: string;
	/** The domain run (demo run) the agent works in. */
	runId: string;
	/** This agent run's id (`agent-…`). */
	agentRunId: string;
	/** Kitchens the run may act for; absent = every kitchen of the workspace. */
	kitchenIds?: readonly string[];
	/** Hard end of the run's authority, ISO time; the loop deadline never runs past it. */
	expiresAt: string;
	/** Effective scopes (initiator ∩ service actor). */
	scopes: readonly string[];
}

export const INTENT_KINDS = [
	'routine_order',
	'seeded_event',
	'shortage_repair',
	'inspect',
	'unsupported'
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** A typed, supported reading of the goal, resolved deterministically before any model call. */
export type Intent =
	| { kind: 'seeded_event'; kitchenId: string; eventId: string }
	| {
			kind: 'routine_order';
			kitchenId: string;
			query: string;
			qty: number;
			deliverBy: string;
	  }
	| { kind: 'shortage_repair'; planId: string }
	| { kind: 'inspect'; planId: string }
	| { kind: 'unsupported'; reason: string };

/** What the planner may read about its situation without a tool call (the context bootstrap). */
export interface AgentContext {
	kitchens: { id: string; name: string }[];
	currentPlan: { id: string; version: number; state: string; kitchenId: string } | null;
	supportedEvents: { id: string; kitchenId: string; title: string }[];
	supportedIntents: readonly IntentKind[];
	/** Scenario "today" (YYYY-MM-DD) used for default delivery dates. */
	today: string;
}

export type GoalStatus = 'fulfilled' | 'partial' | 'awaiting_user' | 'blocked' | 'unsupported';

export interface NeedRef {
	needId: string;
	label: string;
}

/**
 * How the run ended in domain terms, computed from the plan as the store holds it (get_plan), never
 * from the planner's "done". The planner's summary is kept only as an explanation.
 */
export interface GoalOutcome {
	status: GoalStatus;
	intent: IntentKind;
	planId: string | null;
	planVersion: number | null;
	/** Covered by committed lines. */
	confirmedNeeds: NeedRef[];
	/** Covered by lines that are not committed yet (eligible, held or proposed). */
	unconfirmedNeeds: NeedRef[];
	/** No orderable line covers them. */
	unresolvedNeeds: NeedRef[];
	/** Pending approvals waiting for a human. */
	approvalIds: string[];
	nextAction: string;
	reason?: string;
}

/** Tools each intent may use. Checked before every dispatch, on top of the scope gate. */
export const TOOLS_BY_INTENT: Record<IntentKind, readonly ToolName[]> = {
	seeded_event: [
		'plan_event',
		'find_substitutes',
		'get_plan',
		'explain_line',
		'quote',
		'commit_order'
	],
	routine_order: ['search_products', 'quote', 'place_order', 'get_plan', 'commit_order'],
	shortage_repair: ['get_plan', 'find_substitutes', 'explain_line', 'quote', 'search_products'],
	inspect: ['get_plan', 'explain_line'],
	unsupported: []
};
