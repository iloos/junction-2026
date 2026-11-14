import { SCOPES_BY_ACTOR, type ActorKind, type OpEnvelope } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '$lib/server/store/db-ports';
import { proposeMenuHandler } from '$lib/server/menu/tool';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { projectedTaskStore } from '$lib/server/tasks/project';
import { drizzleTaskStore } from '$lib/server/tasks/store';
import type { ContextSource } from './context';
import { buildRunPrincipal } from './principal';
import type { RunPrincipal } from './types';

/**
 * A fresh PGlite workspace for agent trials: real handlers (the same services REST/MCP serve), a context
 * source on the same store, and every op the store commits captured in order. Test-only.
 */
export async function trialWorkspace() {
	const ops: OpEnvelope[] = [];
	// The store's clock is the trial's "today" (14 Nov, midday), so cut-offs agree with the dates the agent picks.
	const env = await createDbPorts({
		now: '2026-11-14T12:00:00+02:00',
		publish: (_ws, events) => {
			for (const e of events) if (e.kind === 'op') ops.push(e.envelope);
		}
	});
	env.overlay.clear();
	// The core handlers plus propose_menu, which the server layer serves (team templates here: no model).
	const handlers: ToolHandlers = {
		...createHandlers(env.ports),
		propose_menu: proposeMenuHandler({ ports: env.ports, llm: () => null })
	} as ToolHandlers;
	// Tasks on the same database (agent_tasks), read with their derived fields fresh, as the server wires them.
	env.ports.tasks ??= projectedTaskStore(
		drizzleTaskStore(env.db as unknown as AnyDb),
		env.ports,
		handlers
	);
	const source: ContextSource = {
		kitchens: (ws) => env.ports.store.kitchens(ws),
		plans: async (ws, run) => Object.values((await env.ports.store.load(ws, run)).plans),
		today: () => '2026-11-14',
		now: () => env.ports.clock.now().toISOString()
	};
	const ctx = (kind: ActorKind, id = `${kind}-1`): CallContext => ({
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind, id },
		scopes: SCOPES_BY_ACTOR[kind],
		via: 'trial'
	});
	const principal = (o: { kitchenIds?: string[]; initiator?: ActorKind; id?: string } = {}) =>
		buildRunPrincipal({
			initiator: ctx(o.initiator ?? 'chef'),
			agentRunId: o.id ?? 'agent-trial',
			kitchenIds: o.kitchenIds
		}) as RunPrincipal;
	const state = () => env.ports.store.load(env.workspaceId, env.runId);
	const mandateVersions = async () =>
		Object.fromEntries(
			(await env.ports.store.kitchens(env.workspaceId)).map((k) => [k.id, k.mandate.version])
		);
	return { env, ops, handlers, source, ctx, principal, state, mandateVersions };
}
