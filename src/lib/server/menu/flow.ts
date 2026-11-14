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
import type {
	CallContext,
	Catalog,
	Llm,
	MenuStore,
	TaskStore,
	ToolHandlers
} from '$lib/core/ports';
import { serveTool } from '$lib/server/tools/serve';
import { kitchenUrl, taskForPlan } from '$lib/server/request/task';
export { kitchenUrl };
import { proposeMenu, type ProposeStep } from './proposal';
import { blocks, reviewProposal, type Issue } from './rubric';

export interface MenuDeps {
	workspaceId: string;
	store: MenuStore;
	catalog: Pick<Catalog, 'get' | 'resolve'>;
	now: () => Date;
}

/** A proposal as the page shows it: the rubric's issues and the names of the products it is pinned to. */
import type { GroundingState } from '$lib/server/web/grounding';

export interface MenuView {
	proposal: MenuProposalT;
	issues: Issue[];
	/** productId → catalogue name, for pinned ingredients. */
	products: Record<string, string>;
	/** What wrote the dishes: a model id or "templates". */
	model: string;
	/** Set when the model failed and the team templates answered. */
	fallback?: string;
	/**
	 * Per dish id: the model's ingredients compared with cited web recipes (web/grounding.ts). Evidence for the chef,
	 * never applied to the proposal. Absent when grounding was not started (fixture catalogue, old proposal).
	 */
	grounding?: Record<string, GroundingState>;
}

/** The plan an accepted menu became, and where the Kitchen shows it. */
export interface MenuPlanResult {
	state: 'planned';
	plan: Plan;
	kitchenUrl: string;
	/** The procurement task the plan belongs to; null when the server has no task store yet. */
	taskId: string | null;
}

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
	o: { kitchenId: string; brief: EventBrief; nonce?: string; onStep?: (s: ProposeStep) => void }
): Promise<MenuView> {
	const r = await proposeMenu({
		kitchenId: o.kitchenId,
		workspaceId: d.workspaceId,
		brief: o.brief,
		store: d.store,
		catalog: d.catalog,
		now: d.now(),
		llm: d.llm,
		nonce: o.nonce,
		onStep: o.onStep
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

/** One chef change to a menu revision. */
export type MenuChange =
	| ({ kind: 'amount' } & AmountEdit)
	/** Drop the pinned product: the ingredient stays on the menu, visibly unresolved. */
	| { kind: 'unresolve'; ingredientId: string }
	| { kind: 'removeIngredient'; ingredientId: string }
	| { kind: 'removeDish'; dishId: string }
	/** Keep a rubric shortfall (diet, courses, dishes) as an open item the chef accepts knowingly. */
	| { kind: 'keepOpen'; issueId: string; text: string };

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

/** The chef's amounts per guest (see editMenu). */
export function editAmounts(
	d: MenuDeps,
	o: { id: string; revision: number; edits: AmountEdit[] }
): Promise<Result<MenuView>> {
	return editMenu(d, {
		id: o.id,
		revision: o.revision,
		changes: o.edits.map((e) => ({ kind: 'amount' as const, ...e }))
	});
}

/**
 * The chef's changes as one new revision: amounts (marked `user`, with the estimate they replaced), products dropped
 * back to unresolved, ingredients or dishes removed, shortfalls kept as open items. Nothing that is not a change
 * makes a revision. Any earlier review stays on its own revision; the new one needs its own.
 */
export async function editMenu(
	d: MenuDeps,
	o: { id: string; revision: number; changes: MenuChange[] }
): Promise<Result<MenuView>> {
	const c = await current(d, o.id, o.revision);
	if (!c.ok) return c;
	const p = c.value;
	const ingredients = new Set(p.dishes.flatMap((x) => x.ingredients.map((i) => i.id)));
	const dishIds = new Set(p.dishes.map((x) => x.id));
	for (const ch of o.changes) {
		if ('ingredientId' in ch && !ingredients.has(ch.ingredientId))
			return err('INVALID_INPUT', `no ingredient ${ch.ingredientId} on menu ${o.id}`);
		if (ch.kind === 'removeDish' && !dishIds.has(ch.dishId))
			return err('INVALID_INPUT', `no dish ${ch.dishId} on menu ${o.id}`);
		if (
			ch.kind === 'amount' &&
			(!Number.isFinite(ch.amountPerCover) || ch.amountPerCover < 0 || ch.amountPerCover > 2000)
		)
			return err('INVALID_INPUT', `${ch.ingredientId}: amount per guest must be 0–2000`);
		if (ch.kind === 'keepOpen' && !/^[\w:.-]{1,64}$/.test(ch.issueId))
			return err('INVALID_INPUT', `bad issue id ${ch.issueId}`);
	}
	const at = d.now().toISOString();
	const did: string[] = [];
	const removedDishes = new Set(
		o.changes.flatMap((ch) => (ch.kind === 'removeDish' ? [ch.dishId] : []))
	);
	const removedIngredients = new Set(
		o.changes.flatMap((ch) => (ch.kind === 'removeIngredient' ? [ch.ingredientId] : []))
	);
	const dishes = p.dishes
		.filter((dish) => !removedDishes.has(dish.id))
		.map((dish) => ({
			...dish,
			ingredients: dish.ingredients
				.filter((i) => !removedIngredients.has(i.id))
				.map((i) => {
					let next = i;
					const amount = o.changes.find(
						(x): x is Extract<MenuChange, { kind: 'amount' }> =>
							x.kind === 'amount' && x.ingredientId === i.id
					);
					if (amount && amount.amountPerCover !== i.amountPerCover) {
						did.push(`${i.label} ${amount.amountPerCover} ${i.unit}`);
						next = {
							...next,
							amountPerCover: amount.amountPerCover,
							provenance: {
								source: 'user' as const,
								at,
								...(i.provenance.ref ? { ref: i.provenance.ref } : {}),
								note: `chef set ${amount.amountPerCover} ${i.unit} per guest (was ${i.amountPerCover} ${i.unit}, ${i.provenance.source === 'user' ? 'chef' : 'estimate'})`
							}
						};
					}
					if (
						next.productId &&
						o.changes.some((x) => x.kind === 'unresolve' && x.ingredientId === i.id)
					) {
						did.push(`${i.label} product dropped`);
						const { productId, ...restIng } = next;
						next = {
							...restIng,
							unresolved: `the chef turned down product ${productId}; find the right one before ordering`
						};
					}
					return next;
				})
		}))
		// A dish whose every ingredient was removed is removed with them.
		.filter((dish) => dish.ingredients.length > 0);
	for (const id of removedDishes) did.push(`dish ${id} removed`);
	for (const id of removedIngredients) did.push(`ingredient ${id} removed`);
	const open = [...p.open];
	for (const ch of o.changes)
		if (ch.kind === 'keepOpen' && !open.some((x) => x.id === ch.issueId)) {
			open.push({ id: ch.issueId, text: `kept open by the chef: ${ch.text}`.slice(0, 300) });
			did.push(`kept open: ${ch.issueId}`);
		}
	if (!did.length) return ok(await menuView(d, p));
	if (!dishes.length) return err('INVALID_INPUT', 'a menu needs at least one dish');
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { review, ...rest } = p;
	const next = MenuProposal.parse({
		...rest,
		revision: p.revision + 1,
		status: 'proposed',
		dishes,
		open,
		provenance: {
			source: 'user',
			at,
			...(p.provenance.ref ? { ref: p.provenance.ref } : {}),
			note: `chef changed revision ${p.revision}: ${did.join('; ')}`.slice(0, 500)
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

/**
 * Plans an accepted revision through the tool gate as the chef: plan_event{proposal} checks the stored review and its
 * digest, and keeps every unresolved ingredient as a need with its reason.
 */
export async function planMenu(
	d: MenuDeps & { handlers: ToolHandlers; ctx: CallContext; tasks?: TaskStore },
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
		const task = await taskForPlan({
			tasks: d.tasks,
			ctx: d.ctx,
			now: d.now(),
			plan,
			title: p.brief.title,
			requirement: {
				kind: 'event',
				guests: p.brief.guests,
				date: p.brief.date,
				dietary: p.brief.dietary
			},
			proposal: { id: o.id, revision: o.revision }
		});
		return ok({ state: 'planned', plan, ...task });
	}
	return r;
}
