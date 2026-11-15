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
import { createKitchen } from './kitchens';

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
 * (server/agent/get-context.ts), get_outcome by server/tasks (it reads the task store), propose_menu and revise_menu
 * by server/menu (a model and the menu store), the web tools by server/web (they need web adapters, not core ports), read_image
 * by server/images (it needs the vision model).
 */
type ServedElsewhere =
	| 'get_context'
	| 'get_outcome'
	| 'propose_menu'
	| 'revise_menu'
	| 'lookup_facts'
	| 'find_outside'
	| 'check_recall'
	| 'read_image';
const IMPLS: { [N in Exclude<ToolName, ServedElsewhere>]: Impl<N> } = {
	search_products: searchProducts,
	quote,
	plan_event: planEvent,
	place_order: placeOrder,
	create_kitchen: createKitchen,
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

/** Kitchen, plan and approval ids an input names, at the top level or one object deep (e.g. `plan: {planId}`). */
function refsOf(input: unknown): {
	kitchenIds: string[];
	planIds: string[];
	approvalIds: string[];
} {
	const r = { kitchenIds: [] as string[], planIds: [] as string[], approvalIds: [] as string[] };
	const take = (o: Record<string, unknown>) => {
		if (typeof o.kitchenId === 'string') r.kitchenIds.push(o.kitchenId);
		if (typeof o.planId === 'string') r.planIds.push(o.planId);
		if (typeof o.approvalId === 'string') r.approvalIds.push(o.approvalId);
	};
	if (input && typeof input === 'object') {
		take(input as Record<string, unknown>);
		for (const v of Object.values(input))
			if (v && typeof v === 'object' && !Array.isArray(v)) take(v as Record<string, unknown>);
	}
	return r;
}

/**
 * A context granted some kitchens (`ctx.kitchenIds`) acts for those only: any kitchen the input names, directly or
 * through a plan or approval, must be granted. Checked before the tool runs, so nothing is read or written for
 * another kitchen.
 */
async function outsideGrant(ports: ServicePorts, ctx: CallContext, input: unknown) {
	const granted = ctx.kitchenIds;
	if (!granted) return null;
	const refs = refsOf(input);
	const kitchens = [...refs.kitchenIds];
	if (refs.planIds.length || refs.approvalIds.length) {
		const state = await ports.store.load(ctx.workspaceId, ctx.runId);
		for (const id of refs.approvalIds) {
			const planId = state.approvals[id]?.planId;
			if (planId) refs.planIds.push(planId);
		}
		for (const id of refs.planIds) {
			const k = state.plans[id]?.kitchenId;
			if (k) kitchens.push(k);
		}
	}
	const outside = kitchens.find((k) => !granted.includes(k));
	return outside
		? err('FORBIDDEN', `this context does not act for kitchen ${outside}`, { sub: 'kitchen' })
		: null;
}

/** Kitchen ids an input names, directly or through a plan or approval. */
async function kitchensNamed(ports: ServicePorts, ctx: CallContext, input: unknown) {
	const refs = refsOf(input);
	const kitchens = [...refs.kitchenIds];
	if (refs.planIds.length || refs.approvalIds.length) {
		const state = await ports.store.load(ctx.workspaceId, ctx.runId);
		for (const id of refs.approvalIds) {
			const planId = state.approvals[id]?.planId;
			if (planId) refs.planIds.push(planId);
		}
		for (const id of refs.planIds) {
			const k = state.plans[id]?.kitchenId;
			if (k) kitchens.push(k);
		}
	}
	return kitchens;
}

/**
 * D24: a kitchen a visitor made takes writes (plan, order, approve, edit) only from that visitor. Fails closed: a
 * door that did not say which visitor it acts for (ctx.visitor absent) is refused on an owned kitchen. Reads stay
 * open (the room watches every store); seeded kitchens (no owner) are unchanged.
 */
async function notOwner(ports: ServicePorts, ctx: CallContext, scope: string, input: unknown) {
	if (scope === 'read') return null;
	// A preview writes nothing (find_substitutes with apply: false): anyone who may read the plan may rank for it.
	if ((input as { apply?: unknown } | null)?.apply === false) return null;
	const named = await kitchensNamed(ports, ctx, input);
	if (!named.length) return null;
	const kitchens = new Map((await ports.store.kitchens(ctx.workspaceId)).map((k) => [k.id, k]));
	// In the shared room a visitor writes only to a store they made; the seeded kitchens are everyone's to watch.
	if (ctx.sharedRoom) {
		const notMine = named
			.map((id) => kitchens.get(id))
			.find((k) => k && (!k.owner || k.owner !== ctx.visitor));
		if (notMine)
			return err(
				'FORBIDDEN',
				`${notMine.name} is not your store in this shared room. Join the room as your own store to order.`,
				{ sub: 'room_store' }
			);
	}
	const k = named.map((id) => kitchens.get(id)).find((k) => k?.owner && k.owner !== ctx.visitor);
	return k
		? err('FORBIDDEN', `${k.name} belongs to another visitor: only its owner can change it`, {
				sub: 'store_owner'
			})
		: null;
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
			if (name === 'approve' && ctx.approveBy === 'elicitation' && !ctx.elicited)
				return err(
					'FORBIDDEN',
					'this client approves only after you accept the exact terms it shows you',
					{ sub: 'elicitation_required' }
				);
			try {
				const denied =
					(await outsideGrant(ports, ctx, parsed.data)) ??
					(await notOwner(ports, ctx, schema.scope, parsed.data));
				if (denied) return denied;
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
