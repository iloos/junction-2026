import { TOOL_NAMES, type Result } from '$lib/core/contracts';
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
import { readImageHandler } from '$lib/server/images/tool';
import { createGetOutcome } from '$lib/server/tasks/outcome';
import { sharedModelMenus } from '$lib/server/menu/proposal';
import { proposeMenuHandler, reviseMenuHandler } from '$lib/server/menu/tool';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { projectedTaskStore } from '$lib/server/tasks/project';
import { drizzleTaskStore } from '$lib/server/tasks/store';
import { scopeFor, withExternalScope } from '$lib/server/external/scope';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';

type AnyHandler = (ctx: CallContext, input: unknown) => Promise<Result<unknown>>;

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
				const { webTools, webSpendKey } = await import('$lib/server/web');
				const w: WebExecutionContext = {
					ctx,
					ports: {
						clock: b.ports.clock,
						catalog: b.ports.catalog,
						store: b.store,
						web: b.ports.web
					},
					spendKey: webSpendKey(ctx)
				};
				return webTools(env)[name](w, input);
			};
		// get_context reads the store and clock only; it lives with the agent door, not in core services.
		const all: Record<string, (ctx: CallContext, input: never) => Promise<unknown>> = {
			...handlers,
			get_context: createGetContext(b.ports),
			// Menus come from Gemini when it is configured, else the team templates; a chef reviews either.
			propose_menu: proposeMenuHandler({
				ports: b.ports,
				modelMenus: sharedModelMenus,
				llm: () =>
					(process.env.VITEST ? 'fixture' : (env.LLM_PROVIDER ?? 'fixture')) === 'fixture'
						? null
						: menuLlm.for('menu.propose')
			}),
			// One change set → the next revision, which a chef accepts again (no model: the changes are explicit).
			revise_menu: reviseMenuHandler({ ports: b.ports }),
			// Pictures go to the vision model (router job image.read); fixture mode reads only the sample pictures.
			read_image: readImageHandler({
				llm: () =>
					(process.env.VITEST ? 'fixture' : (env.LLM_PROVIDER ?? 'fixture')) === 'fixture'
						? null
						: menuLlm.for('image.read')
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
		};
		// Every door (REST, MCP, the agent, /request) runs a call in its workspace's scope, so the simulator overlay
		// and the stock a quote subtracts are that workspace's, never the default one's.
		return Object.fromEntries(
			Object.entries(all).map(([name, fn]) => [
				name,
				(ctx: CallContext, input: never) => inWorkspace(ctx.workspaceId, () => fn(ctx, input))
			])
		) as unknown as ToolHandlers;
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
