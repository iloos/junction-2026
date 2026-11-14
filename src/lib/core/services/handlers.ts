/**
 * One handler per tool (the ToolHandlers seam in core/ports.ts). Every handler: check the caller's scope,
 * validate the input with the tool's zod schema, then run the service. Pure except through `Ports`.
 */
import {
	err,
	ok,
	toolSchemas,
	type DomainError,
	type Line,
	type Plan,
	type Result,
	type ToolInput,
	type ToolName,
	type ToolOutput
} from '../contracts';
import type { CallContext, ToolHandlers } from '../ports';
import { editLine, explainLine, planEvent, type ServicePorts } from './events';
import { approve, commitOrder, getPlan, liveApprovals, placeOrder } from './orders';
import { lineView } from '../mandate/view';
import { withPlanView } from './views';
import { quote, searchProducts } from './quote';
import { findSubstitutes } from './substitutes';

type Impl<N extends ToolName> = (
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<N>
) => Promise<Result<ToolOutput<N>>>;

/** A registered tool core does not serve: it fails explicitly, never with a made-up answer. */
const unavailable =
	(why: string): Impl<ToolName> =>
	async () =>
		err('PROVIDER_UNAVAILABLE', why);

/**
 * Served outside core and composed in server/tools/handlers.ts: get_context by the agent door
 * (server/agent/get-context.ts), get_outcome by server/tasks (it reads the task store), the web tools by server/web
 * (they need web adapters, not core ports).
 */
type ServedElsewhere =
	'get_context' | 'get_outcome' | 'lookup_facts' | 'find_outside' | 'check_recall';
const IMPLS: { [N in Exclude<ToolName, ServedElsewhere>]: Impl<N> } = {
	search_products: searchProducts,
	quote,
	plan_event: planEvent,
	place_order: placeOrder,
	edit_line: editLine,
	find_substitutes: findSubstitutes,
	get_plan: getPlan,
	explain_line: explainLine,
	approve,
	commit_order: commitOrder,
	set_mandate: unavailable('set_mandate is not served: mandates come from the kitchen seed')
};

function invalid(issues: { path: PropertyKey[]; message: string }[]): {
	ok: false;
	error: DomainError;
} {
	return err(
		'INVALID_INPUT',
		issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
	);
}

/** Fills the read models on any output that carries a plan: line views, the plan view (fulfilment), chosen/saved. */
async function withViews(ports: ServicePorts, ctx: CallContext, value: unknown): Promise<unknown> {
	const v = value as { plan?: Plan; chosen?: Line[]; saved?: Line[] };
	if (!v || typeof v !== 'object' || !v.plan) return value;
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	const approval = liveApprovals(state, v.plan.id);
	const plan = await withPlanView(ports, v.plan, state, approval);
	const view = (ls?: Line[]) => ls?.map((l) => ({ ...l, view: lineView(l, plan, approval) }));
	return {
		...v,
		plan,
		...(v.chosen ? { chosen: view(v.chosen) } : {}),
		...(v.saved ? { saved: view(v.saved) } : {})
	};
}

export function createHandlers(ports: ServicePorts): ToolHandlers {
	const out = {} as Record<
		ToolName,
		(ctx: CallContext, input: unknown) => Promise<Result<unknown>>
	>;
	for (const name of Object.keys(toolSchemas) as ToolName[]) {
		const schema = toolSchemas[name];
		const impl =
			((IMPLS as Partial<Record<ToolName, Impl<ToolName>>>)[name] as Impl<ToolName> | undefined) ??
			unavailable(`${name} is served by the server layer, not core`);
		out[name] = async (ctx, input) => {
			if (!ctx.scopes.includes(schema.scope))
				return err('FORBIDDEN', `${ctx.actor.kind} lacks scope "${schema.scope}" for ${name}`, {
					sub: 'scope'
				});
			const parsed = schema.input.safeParse(input);
			if (!parsed.success) return invalid(parsed.error.issues);
			try {
				const r = await impl(ports, ctx, parsed.data as ToolInput<ToolName>);
				return r.ok ? ok(await withViews(ports, ctx, r.value)) : r;
			} catch (e) {
				// A throw is a bug on our side, never the caller's: report it as INTERNAL, not a crash.
				return err('INTERNAL', `${name}: ${e instanceof Error ? e.message : String(e)}`);
			}
		};
	}
	return out as unknown as ToolHandlers;
}
