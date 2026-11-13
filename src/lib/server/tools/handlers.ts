import { TOOL_NAMES, type DomainError, type Result, type ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createServerPorts } from '$lib/server/store/server-ports';
import { stubHandlers } from './stub-handlers';

type AnyHandler = (ctx: CallContext, input: unknown) => Promise<Result<unknown>>;

/** core-db marks unfinished slices with this message; those tools fall back to the stub. */
export function isNotImplemented(e: DomainError): boolean {
	return e.code === 'PROVIDER_UNAVAILABLE' && e.message.startsWith('not implemented yet');
}

/** A call that names a stub-made plan or approval must stay in the stub (the real store has no such row). */
function refersToStub(input: unknown): boolean {
	if (!input || typeof input !== 'object') return false;
	const { planId, approvalId } = input as { planId?: unknown; approvalId?: unknown };
	return (
		(typeof planId === 'string' && planId.startsWith('stub-')) ||
		(typeof approvalId === 'string' && approvalId.startsWith('stub-'))
	);
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
			if (refersToStub(input)) return s(ctx, input);
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

/**
 * One process-wide store: Aiven Postgres when DATABASE_URL is set, otherwise PGlite in memory with the seed
 * kitchens for `ws-demo`/`run-1`. Built on first use and shared by REST, MCP and the agent.
 */
let real: Promise<ToolHandlers> | null = null;
export function realHandlers(): Promise<ToolHandlers> {
	real ??= createServerPorts().then(({ ports }) => createHandlers(ports));
	real.catch(() => (real = null));
	return real;
}

const lazyReal = Object.fromEntries(
	TOOL_NAMES.map((n) => [
		n,
		async (ctx: CallContext, input: unknown) =>
			((await realHandlers())[n] as AnyHandler)(ctx, input)
	])
) as unknown as ToolHandlers;

/** The handlers every surface serves (REST, MCP, the routine agent). */
export const handlers: ToolHandlers = withStubFallback(lazyReal, stubHandlers);
