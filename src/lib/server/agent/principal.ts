import { SCOPES_BY_ACTOR, type Actor } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import type { RunPrincipal } from './types';

/** The routine agent's own identity; it never holds more than this role, whoever starts it. */
export const SERVICE_ACTOR: Actor = { kind: 'kitchen_agent', id: 'routine-agent' };

/** How long a run's authority lasts after it starts. The loop deadline is shorter. */
export const RUN_TTL_MS = 5 * 60_000;

/** The key-less presenter button on /ops (dev, or DEMO_RESET_OPEN=1): a system initiator, labelled. */
export const PRESENTER: Actor = { kind: 'system', id: 'ops-presenter' };

/**
 * Starting a run delegates purchasing work, so it takes the `agent:run` scope. A call context is checked
 * by the scopes its credential holds (a narrowed chef key without `agent:run` may not start runs); a bare
 * actor falls back to its role's scopes.
 */
export function mayStartAgent(who: Actor | Pick<CallContext, 'scopes'>): boolean {
	const scopes: readonly string[] =
		'scopes' in who ? who.scopes : (SCOPES_BY_ACTOR[who.kind] as readonly string[]);
	return scopes.includes('agent:run');
}

/** Initiator ∩ service actor. Never the union: starting the agent cannot add a right the starter lacks. */
export function intersectScopes(a: readonly string[], b: readonly string[]): string[] {
	return a.filter((s) => b.includes(s));
}

/**
 * Builds the run principal from a server-derived context. `ctx` comes from the key table (or the
 * presenter button); nothing here reads the request body. Returns null when the initiator may not start
 * the agent.
 */
export function buildRunPrincipal(o: {
	initiator: Pick<CallContext, 'actor' | 'workspaceId' | 'runId' | 'scopes' | 'visitor'>;
	agentRunId: string;
	kitchenIds?: readonly string[];
	now?: number;
	/** The presenter button is allowed by its own gate (dev or DEMO_RESET_OPEN); keys need `agent:run`. */
	presenter?: boolean;
}): RunPrincipal | null {
	if (!o.presenter && !mayStartAgent(o.initiator)) return null;
	return {
		initiatedBy: o.initiator.actor,
		serviceActor: SERVICE_ACTOR,
		workspaceId: o.initiator.workspaceId,
		runId: o.initiator.runId,
		agentRunId: o.agentRunId,
		...(o.kitchenIds ? { kitchenIds: [...o.kitchenIds] } : {}),
		expiresAt: new Date((o.now ?? Date.now()) + RUN_TTL_MS).toISOString(),
		scopes: intersectScopes(o.initiator.scopes, SCOPES_BY_ACTOR[SERVICE_ACTOR.kind]),
		...(o.initiator.visitor ? { visitor: o.initiator.visitor } : {})
	};
}

/**
 * The context every tool call of the run uses. Ops record `actor` = the service actor; `initiatedBy` names
 * who started the run (services copy it onto each op envelope) and `via` repeats both for readers of the
 * op log that only show `via`. `kitchenIds` carries the run's kitchen grant to the services.
 */
export function principalContext(p: RunPrincipal): CallContext {
	return {
		workspaceId: p.workspaceId,
		runId: p.runId,
		actor: p.serviceActor,
		scopes: p.scopes,
		via: `agent:${p.agentRunId} by ${p.initiatedBy.kind}:${p.initiatedBy.id}`,
		initiatedBy: p.initiatedBy,
		...(p.kitchenIds ? { kitchenIds: p.kitchenIds } : {}),
		...(p.visitor ? { visitor: p.visitor } : {})
	};
}
