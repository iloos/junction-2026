/**
 * The `propose_menu` and `revise_menu` handlers. propose_menu: a brief in, a stored proposal (revision 0) and the
 * rubric's issues out. revise_menu: a change set in, the next revision out. Neither plans or buys anything; a chef
 * accepts a revision before plan_event can use it, so every result points there.
 */
import { z } from 'zod';
import { err, ok, type MenuProposal, type Result } from '$lib/core/contracts';
import { toolSchemas } from '$lib/core/contracts';
import type { CallContext, Catalog, Clock, Llm, MenuStore } from '$lib/core/ports';
import { editMenu } from './flow';
import { proposeMenu } from './proposal';
import type { Issue } from './rubric';

type Input = (typeof toolSchemas)['propose_menu']['input'];

export interface ProposeMenuOutput {
	proposal: MenuProposal;
	issues: Issue[];
	meta?: { summary: string; nextAction?: { tool: string; why: string } };
}

export interface ProposeMenuDeps {
	ports: { menus?: MenuStore; catalog: Pick<Catalog, 'resolve' | 'get'>; clock: Clock };
	/** The model for this caller, or null for the team templates. */
	llm?: (ctx: CallContext) => Llm | null;
}

/**
 * `revise_menu` input. Local until the contract lands (Needs: toolSchemas.revise_menu); the same shape moves to
 * core/contracts. An agent may change amounts and products and add or remove ingredients and dishes; keeping a
 * shortfall open (keepOpen) stays the chef's.
 */
export const ReviseMenuInput = z.object({
	kitchenId: z.string().min(1),
	proposalId: z.string().min(1).max(64),
	revision: z.int().nonnegative(),
	changes: z
		.array(
			z.discriminatedUnion('kind', [
				z.object({
					kind: z.literal('amount'),
					ingredientId: z.string(),
					amountPerCover: z.number()
				}),
				z.object({ kind: z.literal('pin'), ingredientId: z.string(), productId: z.string() }),
				z.object({ kind: z.literal('unresolve'), ingredientId: z.string() }),
				z.object({ kind: z.literal('removeIngredient'), ingredientId: z.string() }),
				z.object({ kind: z.literal('removeDish'), dishId: z.string() }),
				z.object({
					kind: z.literal('addIngredient'),
					dishId: z.string(),
					label: z.string().min(1).max(120),
					query: z.string().min(1).max(120),
					amountPerCover: z.number().positive().max(2000),
					unit: z.enum(['g', 'ml', 'pcs'])
				})
			])
		)
		.min(1)
		.max(30),
	/** The caller's words for why; kept on the revision as theirs, never an instruction or a grant. */
	reasoning: z.string().max(300).optional()
});

export interface ReviseMenuDeps {
	ports: { menus?: MenuStore; catalog: Pick<Catalog, 'resolve' | 'get'>; clock: Clock };
}

/**
 * The `revise_menu` handler: one change set → one new revision, which needs a chef's acceptance again before
 * plan_event can use it. It never accepts, plans or orders.
 */
export function reviseMenuHandler(d: ReviseMenuDeps) {
	return async (
		ctx: CallContext,
		raw: unknown
	): Promise<
		Result<{ proposal: MenuProposal; issues: Issue[]; meta: ProposeMenuOutput['meta'] }>
	> => {
		if (!ctx.scopes.includes('plan'))
			return err('FORBIDDEN', 'revise_menu needs the plan scope', { sub: 'scope' });
		const parsed = ReviseMenuInput.safeParse(raw);
		if (!parsed.success)
			return err(
				'INVALID_INPUT',
				parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
			);
		const input = parsed.data;
		if (ctx.kitchenIds && !ctx.kitchenIds.includes(input.kitchenId))
			return err('FORBIDDEN', `this key does not act for kitchen ${input.kitchenId}`, {
				sub: 'kitchen'
			});
		if (!d.ports.menus) return err('INVALID_INPUT', 'menu proposals are not stored on this server');
		const deps = {
			workspaceId: ctx.workspaceId,
			store: d.ports.menus,
			catalog: d.ports.catalog,
			now: () => d.ports.clock.now()
		};
		const seen = await d.ports.menus.get(ctx.workspaceId, input.proposalId, input.revision);
		if (!seen || seen.kitchenId !== input.kitchenId)
			return err(
				'NOT_FOUND',
				`menu ${input.proposalId} revision ${input.revision} for ${input.kitchenId}`
			);
		const r = await editMenu(deps, {
			id: input.proposalId,
			revision: input.revision,
			changes: input.changes,
			by: ctx.actor,
			reasoning: input.reasoning
		});
		if (!r.ok) return r;
		const p = r.value.proposal;
		const changed = p.revision !== input.revision;
		const blocking = r.value.issues.filter((i) => i.severity === 'block').length;
		return ok({
			proposal: p,
			issues: r.value.issues,
			meta: {
				summary: changed
					? `Menu ${p.id} is now revision ${p.revision}${blocking ? `, ${blocking} blocking issue${blocking === 1 ? '' : 's'}` : ''}. A chef accepts this revision before it can be planned; nothing was planned or ordered.`
					: `Nothing changed: menu ${p.id} stays at revision ${p.revision}.`,
				nextAction: {
					tool: 'plan_event',
					why: `only after a chef accepts revision ${p.revision}; plan_event refuses an unreviewed menu`
				}
			}
		});
	};
}

export function proposeMenuHandler(d: ProposeMenuDeps) {
	return async (ctx: CallContext, raw: unknown): Promise<Result<ProposeMenuOutput>> => {
		if (!ctx.scopes.includes('plan'))
			return err('FORBIDDEN', 'propose_menu needs the plan scope', { sub: 'scope' });
		const parsed = toolSchemas.propose_menu.input.safeParse(raw);
		if (!parsed.success)
			return err(
				'INVALID_INPUT',
				parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
			);
		const input: z.output<Input> = parsed.data;
		if (ctx.kitchenIds && !ctx.kitchenIds.includes(input.kitchenId))
			return err('FORBIDDEN', `this key does not act for kitchen ${input.kitchenId}`, {
				sub: 'kitchen'
			});
		if (!d.ports.menus) return err('INVALID_INPUT', 'menu proposals are not stored on this server');
		const r = await proposeMenu({
			kitchenId: input.kitchenId,
			workspaceId: ctx.workspaceId,
			brief: input.brief,
			store: d.ports.menus,
			catalog: d.ports.catalog,
			now: d.ports.clock.now(),
			llm: d.llm?.(ctx) ?? null,
			by: ctx.actor
		});
		const blocks = r.issues.filter((i) => i.severity === 'block').length;
		const unresolved = r.proposal.dishes
			.flatMap((x) => x.ingredients)
			.filter((i) => i.unresolved !== undefined).length;
		return ok({
			proposal: r.proposal,
			issues: r.issues,
			meta: {
				summary:
					`Menu ${r.proposal.id} revision ${r.proposal.revision}: ${r.proposal.dishes.length} dishes for ${input.brief.guests} guests` +
					`${unresolved ? `, ${unresolved} ingredients without a product yet` : ''}` +
					`${blocks ? `, ${blocks} blocking issue${blocks === 1 ? '' : 's'}` : ''}. Amounts are estimates; nothing was planned or ordered.`,
				nextAction: {
					tool: 'plan_event',
					why: 'only after a chef accepts this revision on /request; plan_event refuses an unreviewed menu'
				}
			}
		});
	};
}
