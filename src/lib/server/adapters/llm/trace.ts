import type { ServerEvent } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { noteExternal } from '../../external/status';
import { insideOuterTrace } from '../../obs/context';
import { log } from '../../obs/log';
import { recordTrace } from '../../obs/traces';

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

/**
 * Every adapter call also writes one structured log line and one stored trace row (obs/traces.ts, kept 7 days),
 * and every outside call (an ExternalCallTrace: `api` and `cache`) is noted for the service status (/healthz, the
 * Ops header). An adapter wrapped by an outside call (external/call.ts) logs at debug and is not stored twice.
 */
export function logTrace(data: Record<string, unknown>, step?: TraceStep) {
	noteExternal(data);
	const { model, source, api, tokensIn, tokensOut, latencyMs, cache, error, purpose } = data;
	const inner = insideOuterTrace();
	const fields = {
		source: source ?? api,
		model,
		purpose,
		cache,
		tokensIn,
		tokensOut,
		ms: latencyMs,
		ok: !error && data.ok !== false,
		...(error ? { error: String(error) } : {})
	};
	const event = model ? 'model.call' : 'outside.call';
	if (inner) log.debug(event, fields);
	else if (error) log.warn(event, fields);
	else log.info(event, fields);
	if (!inner) recordTrace(step ?? (error || data.ok === false ? 'error' : 'tool'), data);
}
