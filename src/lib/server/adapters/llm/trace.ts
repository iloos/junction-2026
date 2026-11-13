import type { ServerEvent } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';

/** Trace step kinds a `trace` ServerEvent carries (CLAUDE.md rule 7). */
export type TraceStep = Extract<ServerEvent, { kind: 'trace' }>['step'];

/**
 * Adapters report each model call through this callback; they do not know the workspace. The caller
 * (agent loop, route) turns it into a ServerEvent with `traceEvent` and hands it to the ops bus.
 */
export type Trace = (step: TraceStep, data: Record<string, unknown>) => void;

export const noTrace: Trace = () => {};

export function traceEvent(
	ctx: Pick<CallContext, 'workspaceId' | 'runId'>,
	step: TraceStep,
	data: Record<string, unknown>,
	at = new Date()
): Extract<ServerEvent, { kind: 'trace' }> {
	return {
		kind: 'trace',
		workspaceId: ctx.workspaceId,
		runId: ctx.runId,
		at: at.toISOString(),
		step,
		data
	};
}

/** Every adapter call also logs one line to the dev console. */
export function logTrace(data: Record<string, unknown>) {
	const { model, source, tokensIn, tokensOut, latencyMs, error } = data;
	console.info(
		`[trace] ${source ?? ''} ${model ?? ''} in=${tokensIn ?? '-'} out=${tokensOut ?? '-'} ${latencyMs}ms${error ? ` error=${error}` : ''}`
	);
}
