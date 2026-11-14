import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { acceptMenu, editAmounts, kitchenUrl, planMenu, proposeForBrief, readMenu } from './flow';
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

	it('planning an accepted menu goes through plan_event{proposal}, or says planning is next', async () => {
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
		if (r.value.state === 'planned') {
			expect(r.value.plan.kitchenId).toBe('k-hotel');
			expect(r.value.kitchenUrl).toBe(kitchenUrl(r.value.plan));
		} else expect(r.value.message).toMatch(/nothing was ordered/);
	});
});
