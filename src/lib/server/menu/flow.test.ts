import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import {
	acceptMenu,
	editAmounts,
	editMenu,
	kitchenUrl,
	planMenu,
	proposeForBrief,
	readMenu
} from './flow';
import { goldenBrief } from './golden';
import { memoryMenuStore } from './store';

async function setup() {
	const env = await createDbPorts();
	const store = memoryMenuStore();
	const d = {
		workspaceId: env.workspaceId,
		store,
		catalog: env.ports.catalog,
		now: () => new Date('2026-12-07T21:40:00+02:00')
	};
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'chef', id: 'chef' },
		scopes: SCOPES_BY_ACTOR.chef,
		via: 'test'
	};
	const view = await proposeForBrief(d, { kitchenId: 'k-hotel', brief: goldenBrief('christmas') });
	return { d, ctx, view, handlers: createHandlers({ ...env.ports, menus: store }) };
}

describe('menu review flow', () => {
	it('shows the proposal with product names, and every unresolved ingredient with its reason', async () => {
		const { view } = await setup();
		expect(view.proposal.revision).toBe(0);
		const ings = view.proposal.dishes.flatMap((d) => d.ingredients);
		for (const i of ings)
			if (i.productId) expect(view.products[i.productId]).toBeTruthy();
			else expect(i.unresolved).toBeTruthy();
		expect(view.model).toBe('templates');
	});

	it('an amount edit is a new revision marked as the chef’s, with the estimate it replaced', async () => {
		const { d, view } = await setup();
		const i = view.proposal.dishes[0].ingredients[0];
		const r = await editAmounts(d, {
			id: view.proposal.id,
			revision: 0,
			edits: [{ ingredientId: i.id, amountPerCover: i.amountPerCover + 10 }]
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.proposal.revision).toBe(1);
		const after = r.value.proposal.dishes[0].ingredients[0];
		expect(after.amountPerCover).toBe(i.amountPerCover + 10);
		expect(after.provenance.source).toBe('user');
		expect(after.provenance.note).toMatch(/was .* estimate/);
		// The revision the chef saw is stale now.
		const stale = await editAmounts(d, {
			id: view.proposal.id,
			revision: 0,
			edits: [{ ingredientId: i.id, amountPerCover: 1 }]
		});
		expect(!stale.ok && stale.error.code).toBe('STALE_VERSION');
		expect((await readMenu(d, view.proposal.id)).ok).toBe(true);
	});

	it('refuses an edit out of bounds or to an unknown ingredient', async () => {
		const { d, view } = await setup();
		const bad = await editAmounts(d, {
			id: view.proposal.id,
			revision: 0,
			edits: [{ ingredientId: 'nope', amountPerCover: 5 }]
		});
		expect(!bad.ok && bad.error.code).toBe('INVALID_INPUT');
		const big = await editAmounts(d, {
			id: view.proposal.id,
			revision: 0,
			edits: [{ ingredientId: view.proposal.dishes[0].ingredients[0].id, amountPerCover: 1e6 }]
		});
		expect(!big.ok && big.error.code).toBe('INVALID_INPUT');
	});

	it('accepting records the chef review server-side; a rubric block refuses it', async () => {
		const { d, view } = await setup();
		const i = view.proposal.dishes[0].ingredients[0];
		// 900 g of one ingredient per guest is a unit slip: blocked.
		const slip = await editAmounts(d, {
			id: view.proposal.id,
			revision: 0,
			edits: [{ ingredientId: i.id, amountPerCover: 900 }]
		});
		expect(slip.ok).toBe(true);
		const refused = await acceptMenu(d, {
			id: view.proposal.id,
			revision: 1,
			by: { kind: 'chef', id: 'chef' }
		});
		expect(!refused.ok && refused.error.code).toBe('INVALID_INPUT');
		await editAmounts(d, {
			id: view.proposal.id,
			revision: 1,
			edits: [{ ingredientId: i.id, amountPerCover: 80 }]
		});
		const ok = await acceptMenu(d, {
			id: view.proposal.id,
			revision: 2,
			by: { kind: 'chef', id: 'chef' }
		});
		expect(ok.ok).toBe(true);
		if (!ok.ok) return;
		expect(ok.value.proposal.status).toBe('chef_reviewed');
		expect(ok.value.proposal.review?.by).toEqual({ kind: 'chef', id: 'chef' });
		// An agent cannot review.
		const agent = await acceptMenu(d, {
			id: view.proposal.id,
			revision: 2,
			by: { kind: 'kitchen_agent', id: 'a' }
		});
		expect(!agent.ok && agent.error.code).toBe('FORBIDDEN');
	});

	it('planning an accepted menu goes through plan_event{proposal}, for real (A4)', async () => {
		const { d, ctx, view, handlers } = await setup();
		const unaccepted = await planMenu(
			{ ...d, handlers, ctx },
			{ id: view.proposal.id, revision: 0 }
		);
		expect(!unaccepted.ok && unaccepted.error.code).toBe('INVALID_INPUT');
		await acceptMenu(d, { id: view.proposal.id, revision: 0, by: ctx.actor });
		const r = await planMenu({ ...d, handlers, ctx }, { id: view.proposal.id, revision: 0 });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.state).toBe('planned');
		if (r.value.state !== 'planned') return;
		expect(r.value.plan.kitchenId).toBe('k-hotel');
		expect(r.value.kitchenUrl).toBe(kitchenUrl(r.value.plan));
	});
});

describe('chef changes that get a blocked menu to Accept', () => {
	it('removes an ingredient or dish, turns a product down, keeps a shortfall open', async () => {
		const { d, view } = await setup();
		const p = view.proposal;
		const [first, second] = p.dishes;
		const ing = first.ingredients[0];
		const r = await editMenu(d, {
			id: p.id,
			revision: 0,
			changes: [
				{ kind: 'removeDish', dishId: second.id },
				{ kind: 'removeIngredient', ingredientId: first.ingredients[1].id },
				{ kind: 'unresolve', ingredientId: ing.id }
			]
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const next = r.value.proposal;
		expect(next.revision).toBe(1);
		expect(next.dishes.map((x) => x.id)).not.toContain(second.id);
		expect(next.dishes[0].ingredients.map((i) => i.id)).not.toContain(first.ingredients[1].id);
		expect(next.dishes[0].ingredients[0].productId).toBeUndefined();
		expect(next.dishes[0].ingredients[0].unresolved).toMatch(/turned down/);
		// A chef revision may drop ids: no "dropped" block.
		expect(r.value.issues.filter((i) => i.id.startsWith('dropped:'))).toEqual([]);
	});

	it('an amount block names its row and fixes; keeping a course shortfall open lets Accept through', async () => {
		const { d, view } = await setup();
		const p = view.proposal;
		const ing = p.dishes[0].ingredients[0];
		const slip = await editMenu(d, {
			id: p.id,
			revision: 0,
			changes: [{ kind: 'amount', ingredientId: ing.id, amountPerCover: 900 }]
		});
		if (!slip.ok) throw new Error(slip.error.message);
		const block = slip.value.issues.find((i) => i.id === `amount:${ing.id}`)!;
		expect(block).toMatchObject({ severity: 'block', targets: [ing.id] });
		expect(block.fixes).toEqual(['amount', 'removeIngredient']);
		const fixed = await editMenu(d, {
			id: p.id,
			revision: 1,
			changes: [{ kind: 'removeIngredient', ingredientId: ing.id }]
		});
		if (!fixed.ok) throw new Error(fixed.error.message);
		expect(fixed.value.issues.filter((i) => i.severity === 'block')).toEqual([]);

		// Cut the buffet below its minimum: a "dishes" block, waivable as an open item.
		const keep = fixed.value.proposal.dishes.slice(0, 1).map((x) => x.id);
		const cut = await editMenu(d, {
			id: p.id,
			revision: 2,
			changes: fixed.value.proposal.dishes
				.filter((x) => !keep.includes(x.id))
				.map((x) => ({ kind: 'removeDish' as const, dishId: x.id }))
		});
		if (!cut.ok) throw new Error(cut.error.message);
		const dishesBlock = cut.value.issues.find((i) => i.id === 'dishes')!;
		expect(dishesBlock).toMatchObject({ severity: 'block', fixes: ['keepOpen'] });
		const open = await editMenu(d, {
			id: p.id,
			revision: 3,
			changes: [{ kind: 'keepOpen', issueId: 'dishes', text: dishesBlock.text }]
		});
		if (!open.ok) throw new Error(open.error.message);
		expect(open.value.issues.find((i) => i.id === 'dishes')?.severity).toBe('warn');
		const acc = await acceptMenu(d, { id: p.id, revision: 4, by: { kind: 'chef', id: 'chef' } });
		expect(acc.ok).toBe(true);
	});
});

describe('a vegetarian menu keeps its vegetables', () => {
	it('beetroot, carrot and pickled cucumber resolve in a vegetarian dish (no label needed)', async () => {
		const env = await createDbPorts();
		const d = {
			workspaceId: env.workspaceId,
			store: memoryMenuStore(),
			catalog: env.ports.catalog,
			now: () => new Date('2026-12-07T21:40:00+02:00')
		};
		const brief = { ...goldenBrief('christmas'), dietary: ['vegetarian'] };
		const view = await proposeForBrief(d, { kitchenId: 'k-hotel', brief });
		const rosolli = view.proposal.dishes.find((x) => /rosolli/i.test(x.name))!;
		for (const i of rosolli.ingredients) expect(i.unresolved, i.label).toBeUndefined();
		// No raw flag anywhere a chef reads.
		expect(JSON.stringify(view)).not.toMatch(/VEGETARIAN/);
	});
});
