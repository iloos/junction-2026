import { SCOPES_BY_ACTOR, type ActorKind, type OpEnvelope } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '$lib/server/store/db-ports';
import type { ContextSource } from './context';
import { buildRunPrincipal } from './principal';
import type { RunPrincipal } from './types';

/**
 * A fresh PGlite workspace for agent trials: real handlers (the same services REST/MCP serve), a context
 * source on the same store, and every op the store commits captured in order. Test-only.
 */
export async function trialWorkspace() {
	const ops: OpEnvelope[] = [];
	const env = await createDbPorts({
		publish: (_ws, events) => {
			for (const e of events) if (e.kind === 'op') ops.push(e.envelope);
		}
	});
	env.overlay.clear();
	const handlers: ToolHandlers = createHandlers(env.ports);
	const source: ContextSource = {
		kitchens: (ws) => env.ports.store.kitchens(ws),
		plans: async (ws, run) => Object.values((await env.ports.store.load(ws, run)).plans),
		today: () => '2026-11-14'
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
