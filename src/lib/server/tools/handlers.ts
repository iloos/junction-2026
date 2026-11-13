import { TOOL_NAMES, type DomainError, type Result, type ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createFixturePorts } from '$lib/server/store/fixture-ports';
import { stubHandlers } from './stub-handlers';

type AnyHandler = (ctx: CallContext, input: unknown) => Promise<Result<unknown>>;

/** core-db marks unfinished slices with this message; those tools fall back to the stub. */
export function isNotImplemented(e: DomainError): boolean {
	return e.code === 'PROVIDER_UNAVAILABLE' && e.message.startsWith('not implemented yet');
}

/**
 * Real handlers first; a tool whose core-db slice has not landed is answered by the stub, so each
 * tool flips to the real path on its own as slices merge. Stubbed answers are logged once per tool.
 */
export function withStubFallback(real: ToolHandlers, stub: ToolHandlers): ToolHandlers {
	const warned = new Set<ToolName>();
	const out = {} as Record<ToolName, AnyHandler>;
	for (const name of TOOL_NAMES) {
		const r = real[name] as AnyHandler;
		const s = stub[name] as AnyHandler;
		out[name] = async (ctx, input) => {
			const res = await r(ctx, input);
			if (res.ok || !isNotImplemented(res.error)) return res;
			if (!warned.has(name)) {
				warned.add(name);
				console.warn(`[tools] ${name}: real handler not implemented yet, serving the STUB`);
			}
			return s(ctx, input);
		};
	}
	return out as unknown as ToolHandlers;
}

let real: ToolHandlers | null = null;
/** The ~17.5k-product catalogue loads on first use, not at import. */
function realHandlers(): ToolHandlers {
	real ??= createHandlers(createFixturePorts());
	return real;
}

const lazyReal = Object.fromEntries(
	TOOL_NAMES.map((n) => [
		n,
		(ctx: CallContext, input: unknown) => (realHandlers()[n] as AnyHandler)(ctx, input)
	])
) as unknown as ToolHandlers;

/** The handlers every surface serves (REST, MCP, the routine agent). */
export const handlers: ToolHandlers = withStubFallback(lazyReal, stubHandlers);
