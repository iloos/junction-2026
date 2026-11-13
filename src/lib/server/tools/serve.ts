import { z } from 'zod';
import {
	err,
	toolSchemas,
	type DomainError,
	type ErrorCode,
	type ToolName,
	type ToolOutput
} from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';

/**
 * The one gate every surface (REST, MCP, the routine agent) calls a tool through: input validated
 * against the registry schema, scope enforced from the server-derived context, handler called,
 * output validated. Handlers also check scope (ports.ts); this check makes a missing one harmless.
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
	PROVIDER_UNAVAILABLE: 503
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

function fail(error: DomainError, status = HTTP_STATUS[error.code]): Served<never> {
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
	const t0 = performance.now();
	const out = await run(name, ctx, rawInput, handlers);
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
		// INTERNAL, so it is reported as a retryable provider failure with HTTP 500.
		console.error(`[tools] ${name} threw`, e);
		return fail(err('PROVIDER_UNAVAILABLE', `${name} failed unexpectedly`).error, 500);
	}
	if (!result.ok) return fail(result.error);

	const output = spec.output.safeParse(result.value);
	if (!output.success) {
		console.error(`[tools] ${name} returned an invalid output`, z.prettifyError(output.error));
		return fail(
			err('PROVIDER_UNAVAILABLE', `${name} returned an invalid output`, {
				detail: { issues: output.error.issues }
			}).error,
			500
		);
	}
	return { ok: true, status: 200, value: output.data as ToolOutput<ToolName> };
}
