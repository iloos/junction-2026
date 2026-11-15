/**
 * The caller of an outside call, carried through async code: which workspace and run a Gemini ranking or a
 * web lookup belongs to, and where its trace goes. Adapters built once per process (Decide in the tool
 * handlers) read it here, so their calls reach the caller's trace drawer and are charged to its spend.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallContext } from '$lib/core/ports';
import { traceEvent, type Trace } from '../adapters/llm/trace';

export interface ExternalScope {
	workspaceId: string;
	runId?: string;
	/** Who pays: a spend key such as the actor id. Absent = the workspace. */
	spendKey?: string;
	/** Who is calling, for the stored trace row. */
	actor?: { kind: string; id: string };
	trace?: Trace;
}

const als = new AsyncLocalStorage<ExternalScope>();

export function withExternalScope<T>(scope: ExternalScope, fn: () => Promise<T>): Promise<T> {
	return als.run(scope, fn);
}

export function currentScope(): ExternalScope | undefined {
	return als.getStore();
}

/**
 * The key a call's model and Decide spend counts against: its workspace, or in the shared room (many visitors in one
 * workspace) the visitor within it, so one visitor can't use up the room. The global caps bound the total either way.
 */
export function spendKeyFor(
	ctx: Pick<CallContext, 'workspaceId' | 'visitor' | 'sharedRoom'>
): string {
	return ctx.sharedRoom && ctx.visitor ? `${ctx.workspaceId}:${ctx.visitor}` : ctx.workspaceId;
}

/** The scope for a tool call: traces go to the caller's workspace event stream (the trace drawer). */
export function scopeFor(
	ctx: Pick<CallContext, 'workspaceId' | 'runId' | 'actor' | 'visitor' | 'sharedRoom'>
): ExternalScope {
	return {
		workspaceId: ctx.workspaceId,
		runId: ctx.runId,
		spendKey: spendKeyFor(ctx),
		...(ctx.actor ? { actor: { kind: ctx.actor.kind, id: ctx.actor.id } } : {}),
		trace: (step, data) => {
			// The bus pulls in the database client; loaded on first trace only.
			void import('../bus')
				.then(({ publish }) =>
					publish(ctx.workspaceId, [
						traceEvent(ctx, step, { actor: ctx.actor?.id, workspaceId: ctx.workspaceId, ...data })
					])
				)
				.catch(() => {});
		}
	};
}
