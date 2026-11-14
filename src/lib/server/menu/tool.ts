/**
 * The planned `propose_menu` tool's handler (contracts/tools-next.ts): a brief in, a stored menu proposal (revision 0)
 * and the rubric's issues out. It plans and buys nothing; a chef reviews the menu before plan_event can use it, so the
 * result points there. Registered by the lead when the tool moves into `toolSchemas`.
 */
import type { z } from 'zod';
import { err, ok, type MenuProposal, type Result } from '$lib/core/contracts';
import { plannedToolSchemas } from '$lib/core/contracts/tools-next';
import type { CallContext, Catalog, Clock, Llm, MenuStore } from '$lib/core/ports';
import { proposeMenu } from './proposal';
import type { Issue } from './rubric';

type Input = (typeof plannedToolSchemas)['propose_menu']['input'];

export interface ProposeMenuOutput {
	proposal: MenuProposal;
	issues: Issue[];
	meta?: { summary: string; nextAction?: { tool: string; why: string } };
}

export interface ProposeMenuDeps {
	ports: { menus?: MenuStore; catalog: Pick<Catalog, 'resolve'>; clock: Clock };
	/** The model for this caller, or null for the team templates. */
	llm?: (ctx: CallContext) => Llm | null;
}

export function proposeMenuHandler(d: ProposeMenuDeps) {
	return async (ctx: CallContext, raw: unknown): Promise<Result<ProposeMenuOutput>> => {
		if (!ctx.scopes.includes('plan'))
			return err('FORBIDDEN', 'propose_menu needs the plan scope', { sub: 'scope' });
		const parsed = plannedToolSchemas.propose_menu.input.safeParse(raw);
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
			llm: d.llm?.(ctx) ?? null
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
