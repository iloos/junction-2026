import type { z } from 'zod';
import { ok, type Plan, type ResultMeta, type Result } from '$lib/core/contracts';
import { toolSchemas } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import type { ServicePorts } from '$lib/core/services/events';
import { liveApprovals } from '$lib/core/services/orders';
import { withPlanView } from '$lib/core/services/views';
import { ALLERGEN_NAMES } from '$lib/core/mandate/meets';
import { hardLimitCents } from '$lib/core/mandate/validate';
import { SCENARIO, scenarioDate } from '$lib/core/scenario';
import { usualSlice } from '$lib/server/patterns/usual';
import { SUPPORTED_EVENTS } from './context';
import { nextFor } from './next';

export type GetContextOutput = z.infer<(typeof toolSchemas)['get_context']['output']>;
export type GetContextHandler = (
	ctx: CallContext,
	input: unknown
) => Promise<Result<GetContextOutput>>;

/** What to do next with an open plan: core's one `nextActionFor` rule, in its own words. */
export const planNextAction = (p: Plan, now?: Date): string => nextFor(p, now).text;

/**
 * `get_context`: the first call of a fresh client. Who the caller is, its scopes, the kitchens it may act
 * for with their seeded events and the next receiving day's usual order (simulated history), the scenario date and
 * cut-off, and its open plans with a next action.
 * Read-only; kitchens outside `ctx.kitchenIds` are left out.
 */
export function createGetContext(ports: ServicePorts): GetContextHandler {
	return async (ctx) => {
		const grant = ctx.kitchenIds ? new Set(ctx.kitchenIds) : null;
		const allowed = (id: string) => !grant || grant.has(id);
		// Kitchens first: the store creates a workspace on its first kitchens read.
		// This visitor's own kitchens first (D26); another visitor's store is theirs alone, so it is left out.
		const kitchens = (await ports.store.kitchens(ctx.workspaceId))
			.filter((k) => allowed(k.id) && (!k.owner || k.owner === ctx.visitor))
			.sort((a, b) => Number(!!b.owner) - Number(!!a.owner));
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
				...(k.owner ? { mine: true } : {}),
				events: SUPPORTED_EVENTS.filter((e) => e.kitchenId === k.id).map((e) => ({
					id: e.id,
					title: e.title
				})),
				deliveryDays: [...k.deliveryDays],
				mandate: {
					version: k.mandate.version,
					words: k.mandate.words,
					lineCapCents: k.mandate.lineCapCents,
					orderCapCents: k.mandate.orderCapCents,
					weeklyCapCents: k.mandate.weeklyCapCents,
					hardLimitCents: hardLimitCents(k.mandate),
					neverDelegate: [...k.mandate.neverDelegate],
					allergenFreeFrom: [...k.constraints.allergens.freeFrom],
					tenderListOnly: k.constraints.tenderListOnly
				},
				usual: usualSlice(k, scenarioDate(ports.clock.now())),
				constraints: {
					freeFrom: k.constraints.allergens.freeFrom.map((code) => ({
						code,
						name: ALLERGEN_NAMES[code] ?? code.toLowerCase()
					})),
					origin: k.constraints.origin.map((o) => ({
						categoryGroup: o.categoryGroup,
						rule: o.rule,
						country: o.country.toLowerCase()
					})),
					notes: [...k.constraints.labels],
					unknownAllergenRecord: k.constraints.allergens.unknownCounts,
					traces: k.constraints.allergens.traces ?? 'hold'
				}
			})),
			// Read with their views (as get_plan returns them), so core's rule sees each line's state as of now.
			openPlans: await Promise.all(
				open.map(async (p) => ({
					planId: p.id,
					version: p.version,
					state: p.state,
					nextAction: planNextAction(
						await withPlanView(ports, p, state, liveApprovals(state, p.id)),
						ports.clock.now()
					)
				}))
			)
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
