import type { Actor, ToolName } from '$lib/core/contracts';
import type { ParsedItem } from '$lib/server/request/parse';
import type { ReqUnit } from '$lib/server/request/lexicon';

/**
 * Agent-local types. RunPrincipal and GoalOutcome are candidates for `src/lib/core/contracts`
 * (see docs/lanes/agent2.md, Needs); until then they live here.
 */

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
	'adjust_need',
	'unsupported'
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** A typed, supported reading of the goal, resolved deterministically before any model call. */
export type Intent =
	| { kind: 'seeded_event'; kitchenId: string; eventId: string }
	| {
			kind: 'routine_order';
			kitchenId: string;
			/** What was asked for, in the chef's words minus quantity ("butter"). */
			query: string;
			/** Physical quantity as asked (4 kg), converted per product into sales units, never assumed. */
			qty: number;
			unit: ReqUnit;
			/** The request parser's reading of the item: search words, constraints, variant. */
			item: Pick<ParsedItem, 'product' | 'search' | 'constraints' | 'variant'>;
			/** On the scenario clock (Helsinki), from the goal's own words. */
			deliverBy: string;
			deliverByText: string;
			/** Readings the chef should see (a weekday read as next week, a Sunday delivery). */
			notes: string[];
	  }
	| { kind: 'shortage_repair'; planId: string }
	| { kind: 'inspect'; planId: string }
	| {
			/** A requirement changed mid-plan: one dish's grams per guest, resized through edit_line. */
			kind: 'adjust_need';
			planId: string;
			/** The goal's words naming the dish, matched against the plan's needs after get_plan. */
			dish: string;
			gramsPerGuest: number;
	  }
	| { kind: 'unsupported'; reason: string };

export type PlanPick = 'named' | 'event' | 'kitchen' | 'shortage' | 'only';

/** What the planner may read about its situation without a tool call (the context bootstrap). */
export interface AgentContext {
	kitchens: { id: string; name: string }[];
	/**
	 * The plan the request is about, or null when there is none or the request does not say which of
	 * several (then `openPlans` lists them and the intent asks).
	 */
	currentPlan: {
		id: string;
		version: number;
		state: string;
		kitchenId: string;
		eventId?: string;
		/** How the request picked it: named its id, its event or its kitchen, or it is the only one open. */
		pickedBy: PlanPick;
	} | null;
	/** Open (uncommitted) plans in the run's kitchens, at most 10. */
	openPlans: { id: string; kitchenId: string; eventId?: string; state: string }[];
	supportedEvents: { id: string; kitchenId: string; title: string }[];
	supportedIntents: readonly IntentKind[];
	/** The kitchen an order without one goes to, when the surface has a default and the run may act for it. */
	defaultKitchenId?: string;
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
	adjust_need: ['get_plan', 'edit_line', 'find_substitutes', 'explain_line'],
	unsupported: []
};
