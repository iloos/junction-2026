import { z } from 'zod';
import {
	err,
	toolSchemas,
	type DomainError,
	type ErrorCode,
	type ResultMeta,
	type ToolName,
	type ToolOutput
} from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { isMetered, takeKeyCall } from './key-limits';
import { presentMeta } from './present';
import { isRecordedRefusal, recordRefusal } from './refusals';

/**
 * The one gate every surface (REST, MCP, the routine agent) calls a tool through: input validated
 * against the registry schema, scope enforced from the server-derived context, handler called,
 * output validated, then `meta` (ResultMeta, present.ts) added. Handlers also check scope (ports.ts);
 * this check makes a missing one harmless.
 */

export const HTTP_STATUS: Record<ErrorCode, number> = {
	INVALID_INPUT: 400,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	STALE_VERSION: 409,
	TERMS_CHANGED: 409,
	DUPLICATE: 409,
	UNKNOWN_REQUIRED: 422,
	INSUFFICIENT_STOCK: 422,
	BELOW_LOT: 422,
	CAP_EXCEEDED: 422,
	PROVIDER_UNAVAILABLE: 503,
	INTERNAL: 500
};

export type Served<N extends ToolName = ToolName> =
	| { ok: true; status: 200; value: ToolOutput<N> }
	| { ok: false; status: number; error: DomainError };

export function isToolName(name: string): name is ToolName {
	return Object.hasOwn(toolSchemas, name);
}

/** Tools the caller may see and call. The MCP tool list and the agent's menu are built from this. */
export function toolsFor(ctx: CallContext): ToolName[] {
	return (Object.keys(toolSchemas) as ToolName[]).filter((n) =>
		ctx.scopes.includes(toolSchemas[n].scope)
	);
}

export interface ServeHooks {
	/** Called once per call with the outcome; the trace and op-log lanes listen here. */
	onCall?: (e: {
		tool: ToolName;
		ctx: CallContext;
		ok: boolean;
		code?: ErrorCode;
		ms: number;
	}) => void;
}

/**
 * A web call refused by a daily cap or a provider's rate limit is PROVIDER_UNAVAILABLE with sub
 * `rate_limit` | `daily_cap` and `detail.retryAfter` (seconds): HTTP 429, so a client waits instead of
 * retrying at once. REST adds `Retry-After`.
 */
export const isWebLimit = (e: DomainError) =>
	e.code === 'PROVIDER_UNAVAILABLE' && (e.sub === 'rate_limit' || e.sub === 'daily_cap');

/** Seconds to wait before retrying, when the error says. */
export function retryAfterOf(e: DomainError): number | undefined {
	const s = (e.detail as { retryAfter?: unknown } | undefined)?.retryAfter;
	return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.ceil(s) : undefined;
}

function fail(
	error: DomainError,
	status = isWebLimit(error) ? 429 : HTTP_STATUS[error.code]
): Served<never> {
	return { ok: false, status, error };
}

export async function serveTool(
	name: string,
	ctx: CallContext,
	rawInput: unknown,
	handlers: ToolHandlers,
	hooks: ServeHooks = {}
): Promise<Served> {
	if (!isToolName(name)) return fail(err('NOT_FOUND', `unknown tool ${name}`).error);
	// A key resolves to its workspace's run synchronously; follow the newest run (a restart or another
	// process's reset) so this call reads and writes the same run.
	ctx = await (await import('$lib/server/demo/reset')).onCurrentRun(ctx);
	const t0 = performance.now();
	// An outside agent's key is metered (key-limits.ts); a full window is a 429, not a refusal for the op log.
	const limited = isMetered(ctx) ? takeKeyCall(ctx, name) : null;
	if (limited) {
		const error = err(
			'PROVIDER_UNAVAILABLE',
			`Too many ${limited.bucket === 'calls' ? '' : `${limited.bucket} `}calls from this key; wait ${limited.retryAfter} s.`,
			{ sub: 'rate_limit', detail: { retryAfter: limited.retryAfter, limit: limited.bucket } }
		).error;
		hooks.onCall?.({ tool: name, ctx, ok: false, code: error.code, ms: 0 });
		return fail(error);
	}
	// Simulated scarcity is per workspace: quotes inside this call see only this workspace's overlay.
	const scoped = ctx;
	const out = await inWorkspace(scoped.workspaceId, () => run(name, scoped, rawInput, handlers));
	// An agent refused by the gate is a trust event: it goes in the op log (refusals.ts).
	if (!out.ok && isRecordedRefusal(ctx, out.error))
		await recordRefusal(ctx, name, rawInput, out.error);
	hooks.onCall?.({
		tool: name,
		ctx,
		ok: out.ok,
		code: out.ok ? undefined : out.error.code,
		ms: Math.round(performance.now() - t0)
	});
	return out;
}

async function run<N extends ToolName>(
	name: N,
	ctx: CallContext,
	rawInput: unknown,
	handlers: ToolHandlers
): Promise<Served> {
	const spec = toolSchemas[name];
	if (!ctx.scopes.includes(spec.scope))
		return fail(
			err('FORBIDDEN', `${ctx.actor.kind} may not call ${name} (needs scope ${spec.scope})`).error
		);

	const input = spec.input.safeParse(rawInput ?? {});
	if (!input.success)
		return fail(
			err('INVALID_INPUT', z.prettifyError(input.error), {
				detail: { issues: input.error.issues }
			}).error
		);

	let result;
	try {
		const handler = handlers[name] as (c: CallContext, i: unknown) => ReturnType<ToolHandlers[N]>;
		result = await handler(ctx, input.data);
	} catch (e) {
		// A thrown handler is a bug or an outage we did not classify; the closed code set has no
		// INTERNAL: a bug on our side, not retryable.
		console.error(`[tools] ${name} threw`, e);
		return fail(err('INTERNAL', `${name} failed unexpectedly`).error, 500);
	}
	if (!result.ok) return fail(result.error);

	const output = spec.output.safeParse(result.value);
	if (!output.success) {
		console.error(`[tools] ${name} returned an invalid output`, z.prettifyError(output.error));
		return fail(
			err('INTERNAL', `${name} returned an invalid output`, {
				detail: { issues: output.error.issues }
			}).error,
			500
		);
	}
	const value = output.data as ToolOutput<ToolName> & { meta?: ResultMeta };
	// Our own summary and next step, unless the handler wrote one; never fatal to the call.
	if (!value.meta)
		try {
			const meta = presentMeta(name, input.data, value);
			if (meta) value.meta = meta;
		} catch (e) {
			console.error(`[tools] ${name}: meta failed`, e);
		}
	return { ok: true, status: 200, value };
}
