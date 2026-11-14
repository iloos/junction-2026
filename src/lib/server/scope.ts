import type { CallContext } from '$lib/core/ports';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { scopeFor, withExternalScope } from '$lib/server/external/scope';
import { annotateRequest } from '$lib/server/obs/context';

/**
 * Run `fn` as one caller: its workspace's run is loaded, the scenario clock and simulator overlay read that
 * workspace, and outside calls (Gemini, Valio, web) trace into its drawer and charge its caps. Every door that
 * calls ports or handlers outside `serveTool` enters through here.
 */
export async function withCallScope<T>(
	ctx: Pick<CallContext, 'workspaceId' | 'runId' | 'actor'>,
	fn: () => Promise<T>
): Promise<T> {
	annotateRequest({
		workspaceId: ctx.workspaceId,
		runId: ctx.runId,
		...(ctx.actor ? { actor: { kind: ctx.actor.kind, id: ctx.actor.id } } : {})
	});
	await ensureRunLoaded(ctx.workspaceId);
	return inWorkspace(ctx.workspaceId, () => withExternalScope(scopeFor(ctx), fn));
}
