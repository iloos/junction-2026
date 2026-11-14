import { TOOL_NAMES, type DomainError, type Result, type ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers, WebExecutionContext } from '$lib/core/ports';
import type { WebToolName } from '$lib/server/web/tools';
import { createHandlers } from '$lib/core/services/handlers';
import { createServerPorts } from '$lib/server/store/server-ports';
import { createOps, drizzleOpsReader, setFixtureOpsReader } from '$lib/server/bus';
import { dbMode } from '$lib/server/db/client';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { env } from '$env/dynamic/private';
import { createDecide } from '$lib/server/adapters/decide';
import { createGetContext } from '$lib/server/agent/get-context';
import { createGetOutcome } from '$lib/server/tasks/outcome';
import { proposeMenuHandler } from '$lib/server/menu/tool';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { projectedTaskStore } from '$lib/server/tasks/project';
import { drizzleTaskStore } from '$lib/server/tasks/store';
import { scopeFor, withExternalScope } from '$lib/server/external/scope';

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
	real ??= createServerPorts().then((b) => {
		// Fixture mode: the event stream catches up from the same PGlite the tools write to.
		if (dbMode() === 'fixture') setFixtureOpsReader(drizzleOpsReader(b.db as unknown as AnyDb));
		// Gemini Decisions (live unless LLM_PROVIDER=fixture) with recorded replay, then rules.
		const decide = createDecide({
			// Tests never call Gemini: replay and rules only.
			env: process.env.VITEST ? { ...env, LLM_PROVIDER: 'fixture' } : env,
			replayPath: 'src/lib/server/adapters/decide/replay.json',
			record: env.DECIDE_RECORD === '1'
		});
		const handlers = createHandlers({ ...b.ports, decide, ops: createOps() });
		const menuLlm = createLlmRouter(env);
		// The web tools run under the caller's WebExecutionContext (F19): its workspace and run, these
		// ports, and its key id for the daily web spend. Loaded on first call: server/web imports this module.
		const web =
			(name: WebToolName) =>
			async (ctx: CallContext, input: unknown): Promise<Result<unknown>> => {
				const { webTools } = await import('$lib/server/web');
				const w: WebExecutionContext = {
					ctx,
					ports: {
						clock: b.ports.clock,
						catalog: b.ports.catalog,
						store: b.store,
						web: b.ports.web
					},
					spendKey: ctx.actor.id
				};
				return webTools(env)[name](w, input);
			};
		// get_context reads the store and clock only; it lives with the agent door, not in core services.
		return {
			...handlers,
			get_context: createGetContext(b.ports),
			// Menus come from Gemini when it is configured, else the team templates; a chef reviews either.
			propose_menu: proposeMenuHandler({
				ports: b.ports,
				llm: () =>
					(process.env.VITEST ? 'fixture' : (env.LLM_PROVIDER ?? 'fixture')) === 'fixture'
						? null
						: menuLlm.for('menu.propose')
			}),
			// Ledgers are recomputed from the plans on every read, never taken from a stored task.
			get_outcome: createGetOutcome(
				{
					...b.ports,
					tasks: projectedTaskStore(drizzleTaskStore(b.db as unknown as AnyDb), b.ports, handlers)
				},
				handlers
			),
			lookup_facts: web('lookup_facts'),
			find_outside: web('find_outside'),
			check_recall: web('check_recall')
		} as ToolHandlers;
	});
	real.catch(() => (real = null));
	return real;
}

const lazyReal = Object.fromEntries(
	TOOL_NAMES.map((n) => [
		n,
		// Outside calls made for this tool (Gemini ranking, web lookups) trace into the caller's workspace and are
		// charged to it.
		async (ctx: CallContext, input: unknown) =>
			withExternalScope(scopeFor(ctx), async () =>
				((await realHandlers())[n] as AnyHandler)(ctx, input)
			)
	])
) as unknown as ToolHandlers;

/**
 * The handlers every surface serves (REST, MCP, the routine agent). No stub fallback: every tool is real,
 * and an unimplemented one (set_mandate) fails explicitly instead of answering from an in-memory stub.
 */
export const handlers: ToolHandlers = lazyReal;
