import { SCOPES_BY_ACTOR, type Actor } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { AGENT_RUN_ACTORS, type RunPrincipal } from './types';

/** The routine agent's own identity; it never holds more than this role, whoever starts it. */
export const SERVICE_ACTOR: Actor = { kind: 'kitchen_agent', id: 'routine-agent' };

/** How long a run's authority lasts after it starts. The loop deadline is shorter. */
export const RUN_TTL_MS = 5 * 60_000;

/** The key-less presenter button on /ops (dev, or DEMO_RESET_OPEN=1): a system initiator, labelled. */
export const PRESENTER: Actor = { kind: 'system', id: 'ops-presenter' };

export function mayStartAgent(actor: Actor): boolean {
	return AGENT_RUN_ACTORS.includes(actor.kind);
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
	initiator: Pick<CallContext, 'actor' | 'workspaceId' | 'runId' | 'scopes'>;
	agentRunId: string;
	kitchenIds?: readonly string[];
	now?: number;
	/** The presenter button is allowed by its own gate (dev or DEMO_RESET_OPEN); keys need `agent:run`. */
	presenter?: boolean;
}): RunPrincipal | null {
	if (!o.presenter && !mayStartAgent(o.initiator.actor)) return null;
	return {
		initiatedBy: o.initiator.actor,
		serviceActor: SERVICE_ACTOR,
		workspaceId: o.initiator.workspaceId,
		runId: o.initiator.runId,
		agentRunId: o.agentRunId,
		...(o.kitchenIds ? { kitchenIds: [...o.kitchenIds] } : {}),
		expiresAt: new Date((o.now ?? Date.now()) + RUN_TTL_MS).toISOString(),
		scopes: intersectScopes(o.initiator.scopes, SCOPES_BY_ACTOR[SERVICE_ACTOR.kind])
	};
}

/**
 * The context every tool call of the run uses. Ops record `actor` = the service actor and `via` names the
 * run and the initiator, so the op log keeps both until the envelope has an `initiatedBy` field.
 */
export function principalContext(p: RunPrincipal): CallContext {
	return {
		workspaceId: p.workspaceId,
		runId: p.runId,
		actor: p.serviceActor,
		scopes: p.scopes,
		via: `agent:${p.agentRunId} by ${p.initiatedBy.kind}:${p.initiatedBy.id}`
	};
}
