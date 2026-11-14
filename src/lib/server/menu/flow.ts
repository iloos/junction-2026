/**
 * The chef's side of a menu: show a proposal, edit its amounts (each edit a new revision with `user` provenance),
 * accept it (the server records the review), then plan it through `plan_event{proposal:{id, revision}}`. Every step
 * reads and writes the MenuStore; a client never sends a proposal body, only ids, revisions and amounts.
 */
import {
	err,
	MenuProposal,
	ok,
	type Actor,
	type EventBrief,
	type MenuProposal as MenuProposalT,
	type Plan,
	type Result
} from '$lib/core/contracts';
import type { CallContext, Catalog, Llm, MenuStore, ToolHandlers } from '$lib/core/ports';
import { serveTool } from '$lib/server/tools/serve';
import { proposeMenu } from './proposal';
import { blocks, reviewProposal, type Issue } from './rubric';

export interface MenuDeps {
	workspaceId: string;
	store: MenuStore;
	catalog: Pick<Catalog, 'get' | 'resolve'>;
	now: () => Date;
}

/** A proposal as the page shows it: the rubric's issues and the names of the products it is pinned to. */
export interface MenuView {
	proposal: MenuProposalT;
	issues: Issue[];
	/** productId → catalogue name, for pinned ingredients. */
	products: Record<string, string>;
	/** What wrote the dishes: a model id or "templates". */
	model: string;
	/** Set when the model failed and the team templates answered. */
	fallback?: string;
}

/** Where planning stands after the chef accepted a menu. */
export type MenuPlanResult =
	| { state: 'planned'; plan: Plan; kitchenUrl: string }
	/** plan_event cannot plan from a proposal yet (A4): the review is recorded and planning is next. */
	| { state: 'next'; message: string };

export async function menuView(
	d: Pick<MenuDeps, 'catalog'>,
	proposal: MenuProposalT,
	previous?: MenuProposalT | null,
	extra: { model?: string; fallback?: string } = {}
): Promise<MenuView> {
	const ids = [
		...new Set(
			proposal.dishes.flatMap((x) =>
				x.ingredients.flatMap((i) => (i.productId ? [i.productId] : []))
			)
		)
	];
	const got = ids.length ? await d.catalog.get(ids) : new Map();
	return {
		proposal,
		issues: reviewProposal(proposal.brief, proposal, previous),
		products: Object.fromEntries([...got].map(([id, p]) => [id, p.nameFi])),
		model: extra.model ?? proposal.provenance.ref ?? '',
		...(extra.fallback ? { fallback: extra.fallback } : {})
	};
}

/** Proposes a menu for a complete brief (revision 0, stored before it is returned). */
export async function proposeForBrief(
	d: MenuDeps & { llm?: Llm | null },
	o: { kitchenId: string; brief: EventBrief; nonce?: string }
): Promise<MenuView> {
	const r = await proposeMenu({
		kitchenId: o.kitchenId,
		workspaceId: d.workspaceId,
		brief: o.brief,
		store: d.store,
		catalog: d.catalog,
		now: d.now(),
		llm: d.llm,
		nonce: o.nonce
	});
	// A stored proposal may have newer revisions (the chef edited it): show the latest.
	const latest = (await d.store.latest(d.workspaceId, r.proposal.id)) ?? r.proposal;
	const previous =
		latest.revision > 0 ? await d.store.get(d.workspaceId, latest.id, latest.revision - 1) : null;
	return menuView(d, latest, previous, { model: r.model, fallback: r.fallback });
}

export async function readMenu(
	d: MenuDeps,
	id: string,
	revision?: number
): Promise<Result<MenuView>> {
	const p =
		revision === undefined
			? await d.store.latest(d.workspaceId, id)
			: await d.store.get(d.workspaceId, id, revision);
	if (!p)
		return err('NOT_FOUND', `menu ${id}${revision === undefined ? '' : ` revision ${revision}`}`);
	const previous = p.revision > 0 ? await d.store.get(d.workspaceId, id, p.revision - 1) : null;
	return ok(await menuView(d, p, previous));
}

export interface AmountEdit {
	ingredientId: string;
	amountPerCover: number;
}

/** The latest revision, or why the chef's edit or review cannot apply to the revision they saw. */
async function current(d: MenuDeps, id: string, revision: number): Promise<Result<MenuProposalT>> {
	const latest = await d.store.latest(d.workspaceId, id);
	if (!latest) return err('NOT_FOUND', `menu ${id}`);
	if (latest.revision !== revision)
		return err(
			'STALE_VERSION',
			`menu ${id} is at revision ${latest.revision}; you saw ${revision}. Reload it.`,
			{ detail: { latest: latest.revision } }
		);
	if (latest.status === 'planned') return err('INVALID_INPUT', `menu ${id} is already planned`);
	return ok(latest);
}

/**
 * The chef's amounts per guest: a new revision with every changed ingredient marked `user`, the estimate it replaced
 * in the note. Unchanged amounts are not an edit. Any earlier review stays on its own revision; the new one needs
 * its own.
 */
export async function editAmounts(
	d: MenuDeps,
	o: { id: string; revision: number; edits: AmountEdit[] }
): Promise<Result<MenuView>> {
	const c = await current(d, o.id, o.revision);
	if (!c.ok) return c;
	const p = c.value;
	const known = new Set(p.dishes.flatMap((x) => x.ingredients.map((i) => i.id)));
	for (const e of o.edits) {
		if (!known.has(e.ingredientId))
			return err('INVALID_INPUT', `no ingredient ${e.ingredientId} on menu ${o.id}`);
		if (!Number.isFinite(e.amountPerCover) || e.amountPerCover < 0 || e.amountPerCover > 2000)
			return err('INVALID_INPUT', `${e.ingredientId}: amount per guest must be 0–2000`);
	}
	const at = d.now().toISOString();
	let changed = 0;
	const dishes = p.dishes.map((dish) => ({
		...dish,
		ingredients: dish.ingredients.map((i) => {
			const e = o.edits.find((x) => x.ingredientId === i.id);
			if (!e || e.amountPerCover === i.amountPerCover) return i;
			changed++;
			return {
				...i,
				amountPerCover: e.amountPerCover,
				provenance: {
					source: 'user' as const,
					at,
					...(i.provenance.ref ? { ref: i.provenance.ref } : {}),
					note: `chef set ${e.amountPerCover} ${i.unit} per guest (was ${i.amountPerCover} ${i.unit}, ${i.provenance.source === 'user' ? 'chef' : 'estimate'})`
				}
			};
		})
	}));
	if (!changed) return ok(await menuView(d, p));
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { review, ...rest } = p;
	const next = MenuProposal.parse({
		...rest,
		revision: p.revision + 1,
		status: 'proposed',
		dishes,
		provenance: {
			source: 'user',
			at,
			...(p.provenance.ref ? { ref: p.provenance.ref } : {}),
			note: `chef edited ${changed} amount${changed === 1 ? '' : 's'} of revision ${p.revision}`
		}
	});
	await d.store.put(d.workspaceId, next);
	return ok(await menuView(d, next, p));
}

/**
 * The chef accepts this exact revision. Refused while the rubric blocks it, so an accepted menu always keeps the
 * brief's guests, date, courses and requirements. Accepting authorises planning from these estimates; it verifies
 * no allergen and grants no spending.
 */
export async function acceptMenu(
	d: MenuDeps,
	o: { id: string; revision: number; by: Actor }
): Promise<Result<MenuView>> {
	const c = await current(d, o.id, o.revision);
	if (!c.ok) return c;
	const b = blocks(reviewProposal(c.value.brief, c.value));
	if (b.length)
		return err('INVALID_INPUT', `fix this before accepting: ${b.map((x) => x.text).join('; ')}`, {
			detail: { issues: b }
		});
	const r = await d.store.review(d.workspaceId, o.id, o.revision, o.by, d.now());
	if (!r.ok) return r;
	return ok(await menuView(d, r.value));
}

/** The Kitchen page focused on one plan (the deep link Ops uses). */
export function kitchenUrl(plan: Pick<Plan, 'kitchenId' | 'id' | 'version'>): string {
	const q = new URLSearchParams({
		kitchen: plan.kitchenId,
		plan: plan.id,
		v: String(plan.version)
	});
	return `/?${q}`;
}

/**
 * Plans an accepted revision through the tool gate as the chef. Until plan_event plans from a proposal (A4), the
 * review stays recorded and the answer says planning is next.
 */
export async function planMenu(
	d: MenuDeps & { handlers: ToolHandlers; ctx: CallContext },
	o: { id: string; revision: number }
): Promise<Result<MenuPlanResult>> {
	const p = await d.store.get(d.workspaceId, o.id, o.revision);
	if (!p) return err('NOT_FOUND', `menu ${o.id} revision ${o.revision}`);
	if (!p.review)
		return err('INVALID_INPUT', `menu ${o.id} revision ${o.revision} is not accepted yet`);
	const r = await serveTool(
		'plan_event',
		d.ctx,
		{ kitchenId: p.kitchenId, proposal: { id: o.id, revision: o.revision } },
		d.handlers
	);
	if (r.ok) {
		const plan = (r.value as { plan: Plan }).plan;
		return ok({ state: 'planned', plan, kitchenUrl: kitchenUrl(plan) });
	}
	if (r.error.code === 'INVALID_INPUT' && /not available yet/.test(r.error.message))
		return ok({
			state: 'next',
			message:
				'Menu accepted and recorded. Planning from an accepted menu is the next step to land; nothing was ordered.'
		});
	return r;
}
