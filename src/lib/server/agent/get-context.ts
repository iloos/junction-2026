import type { z } from 'zod';
import { ok, type Plan, type ResultMeta, type Result } from '$lib/core/contracts';
import { toolSchemas } from '$lib/core/contracts';
import type { CallContext, Ports } from '$lib/core/ports';
import { SCENARIO } from '$lib/core/scenario';
import { SUPPORTED_EVENTS } from './context';
import { nextActionFor } from './next-action';

export type GetContextOutput = z.infer<(typeof toolSchemas)['get_context']['output']>;
export type GetContextHandler = (
	ctx: CallContext,
	input: unknown
) => Promise<Result<GetContextOutput>>;

/** What to do next with an open plan: the one `nextActionFor` rule, in its own words. */
export const planNextAction = (p: Plan): string => nextActionFor(p).text;

/**
 * `get_context`: the first call of a fresh client. Who the caller is, its scopes, the kitchens it may act
 * for with their seeded events, the scenario date and cut-off, and its open plans with a next action.
 * Read-only; kitchens outside `ctx.kitchenIds` are left out.
 */
export function createGetContext(ports: Pick<Ports, 'store' | 'clock'>): GetContextHandler {
	return async (ctx) => {
		const grant = ctx.kitchenIds ? new Set(ctx.kitchenIds) : null;
		const allowed = (id: string) => !grant || grant.has(id);
		// Kitchens first: the store creates a workspace on its first kitchens read.
		const kitchens = (await ports.store.kitchens(ctx.workspaceId)).filter((k) => allowed(k.id));
		const state = await ports.store.load(ctx.workspaceId, ctx.runId);
		const open = Object.values(state.plans).filter(
			(p) => allowed(p.kitchenId) && p.state !== 'committed'
		);
		const value: GetContextOutput = {
			actor: { kind: ctx.actor.kind, id: ctx.actor.id },
			scopes: [...ctx.scopes],
			workspaceId: ctx.workspaceId,
			scenario: {
				now: ports.clock.now().toISOString(),
				cutoff: SCENARIO.cutoff,
				delivery: SCENARIO.delivery
			},
			kitchens: kitchens.map((k) => ({
				id: k.id,
				name: k.name,
				events: SUPPORTED_EVENTS.filter((e) => e.kitchenId === k.id).map((e) => ({
					id: e.id,
					title: e.title
				}))
			})),
			openPlans: open.map((p) => ({
				planId: p.id,
				version: p.version,
				state: p.state,
				nextAction: planNextAction(p)
			}))
		};
		value.meta = contextMeta(value);
		return ok(value);
	};
}

/** The one-line summary and the next tool, from the typed fields above. */
function contextMeta(v: GetContextOutput): ResultMeta {
	const plans = v.openPlans.length;
	const summary =
		`You are ${v.actor.kind}:${v.actor.id} with ${v.scopes.join(', ') || 'no'} scopes in ${v.workspaceId}; ` +
		`${v.kitchens.length} kitchen(s), ${plans} open plan(s).`;
	const plan = v.openPlans[0];
	if (plan)
		return {
			summary,
			nextAction: {
				tool: 'get_plan',
				why: `read open plan ${plan.planId}: ${plan.nextAction}`,
				args: { planId: plan.planId }
			}
		};
	const k = v.kitchens.find((x) => x.events.length);
	if (k && v.scopes.includes('plan'))
		return {
			summary,
			nextAction: {
				tool: 'plan_event',
				why: `plan the seeded event ${k.events[0].title} for ${k.id}`,
				args: { kitchenId: k.id, eventId: k.events[0].id }
			}
		};
	return {
		summary,
		nextAction: {
			tool: 'search_products',
			why: 'find a product to order',
			args: { query: 'maito' }
		}
	};
}
