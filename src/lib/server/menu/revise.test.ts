import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { acceptMenu, proposeForBrief } from './flow';
import { goldenBrief } from './golden';
import { proposeMenu } from './proposal';
import { memoryMenuStore } from './store';
import { reviseMenuHandler } from './tool';

async function setup(dietary: string[] = []) {
	const env = await createDbPorts();
	const store = memoryMenuStore();
	const now = () => new Date('2026-12-07T21:40:00+02:00');
	const d = { workspaceId: env.workspaceId, store, catalog: env.ports.catalog, now };
	const brief = { ...goldenBrief('christmas'), dietary };
	const view = await proposeForBrief(d, { kitchenId: 'k-hotel', brief });
	const agent: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'external_agent', id: 'judge-abc' },
		scopes: SCOPES_BY_ACTOR.external_agent,
		via: 'test'
	};
	const revise = reviseMenuHandler({
		ports: { menus: store, catalog: env.ports.catalog, clock: { now } }
	});
	return { env, d, view, agent, revise, store };
}

/** Some catalogue product other than the one already pinned, found through the resolver. */
async function another(env: Awaited<ReturnType<typeof createDbPorts>>, q: string, not?: string) {
	const r = await env.ports.catalog.resolve!(q, { limit: 3 });
	if (r.status !== 'resolved') throw new Error(`no product for ${q}`);
	return r.candidates.map((c) => c.productId).find((id) => id !== not) ?? r.candidates[0].productId;
}

describe('revise_menu', () => {
	it('pins one product: a new revision, the other products unchanged, the agent named, the review cleared', async () => {
		const { env, d, view, agent, revise } = await setup();
		const chef = { kind: 'chef' as const, id: 'chef' };
		expect((await acceptMenu(d, { id: view.proposal.id, revision: 0, by: chef })).ok).toBe(true);
		const target = view.proposal.dishes
			.flatMap((x) => x.ingredients)
			.find((i) => i.productId && /potato/i.test(i.label))!;
		const pick = await another(env, 'peruna', target.productId);
		const r = await revise(agent, {
			kitchenId: 'k-hotel',
			proposalId: view.proposal.id,
			revision: 0,
			changes: [{ kind: 'pin', ingredientId: target.id, productId: pick }],
			reasoning: 'the chef prefers this potato'
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const p = r.value.proposal;
		expect(p.revision).toBe(1);
		expect(p.review).toBeUndefined();
		const after = p.dishes.flatMap((x) => x.ingredients);
		expect(after.find((i) => i.id === target.id)?.productId).toBe(pick);
		for (const i of view.proposal.dishes.flatMap((x) => x.ingredients))
			if (i.id !== target.id) expect(after.find((x) => x.id === i.id)?.productId).toBe(i.productId);
		expect(after.find((i) => i.id === target.id)?.provenance.note).toContain(
			'agent judge-abc pinned'
		);
		expect(p.provenance.note).toContain('"the chef prefers this potato"');
		expect(r.value.meta?.summary).toContain('A chef accepts this revision');
		// Marked as an agent's pin, so the kitchen's next menu starts from it.
		expect(after.find((i) => i.id === target.id)?.pinnedBy).toBe('agent');
	});

	it('the pin is used first by the kitchen’s next proposal', async () => {
		const { env, view, agent, revise, store } = await setup();
		const target = view.proposal.dishes
			.flatMap((x) => x.ingredients)
			.find((i) => i.productId && /potato/i.test(i.label))!;
		const pick = await another(env, 'peruna', target.productId);
		await revise(agent, {
			kitchenId: 'k-hotel',
			proposalId: view.proposal.id,
			revision: 0,
			changes: [{ kind: 'pin', ingredientId: target.id, productId: pick }]
		});
		const next = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: env.workspaceId,
			brief: { ...goldenBrief('christmas'), title: 'Another Christmas buffet' },
			store,
			catalog: env.ports.catalog,
			now: new Date('2026-12-07T22:00:00+02:00')
		});
		const potato = next.proposal.dishes
			.flatMap((x) => x.ingredients)
			.find((i) => /potato/i.test(i.label));
		expect(potato?.productId).toBe(pick);
		expect(potato?.provenance.note).toContain('an agent pinned it');
	});

	it('adds an ingredient, resolved like a proposed one', async () => {
		const { view, agent, revise } = await setup();
		const dish = view.proposal.dishes[0];
		const r = await revise(agent, {
			kitchenId: 'k-hotel',
			proposalId: view.proposal.id,
			revision: 0,
			changes: [
				{
					kind: 'addIngredient',
					dishId: dish.id,
					label: 'Carrot',
					query: 'porkkana',
					amountPerCover: 30,
					unit: 'g'
				}
			]
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const added = r.value.proposal.dishes[0].ingredients.at(-1)!;
		expect(added.label).toBe('Carrot');
		expect(added.productId ?? added.unresolved).toBeTruthy();
		expect(added.provenance.note).toContain('added by agent judge-abc');
	});

	it('refuses a pin that breaks the menu’s diet, a stale revision, keepOpen, another kitchen and a read-only key', async () => {
		const { env, view, agent, revise } = await setup(['lactose-free']);
		const ing = view.proposal.dishes.flatMap((x) => x.ingredients).find((i) => i.productId)!;
		// Plain whipping cream contains milk (AM) and isn't lactose-free.
		const cream = await env.ports.catalog.resolve!('kuohukerma', { limit: 3 });
		const milky =
			cream.status === 'resolved'
				? await env.ports.catalog.get(cream.candidates.map((c) => c.productId))
				: new Map();
		const plain = [...milky.values()].find(
			(p) => p.allergens.contains.includes('AM') && !p.freeFrom.includes('LACTOSE')
		);
		if (plain) {
			const r = await revise(agent, {
				kitchenId: 'k-hotel',
				proposalId: view.proposal.id,
				revision: 0,
				changes: [{ kind: 'pin', ingredientId: ing.id, productId: plain.productId }]
			});
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.message).toMatch(/lactose-free/);
		}
		const stale = await revise(agent, {
			kitchenId: 'k-hotel',
			proposalId: view.proposal.id,
			revision: 5,
			changes: [{ kind: 'removeIngredient', ingredientId: ing.id }]
		});
		expect(stale.ok).toBe(false);
		const keepOpen = await revise(agent, {
			kitchenId: 'k-hotel',
			proposalId: view.proposal.id,
			revision: 0,
			changes: [{ kind: 'keepOpen', issueId: 'courses', text: 'fine' }]
		});
		expect(keepOpen.ok).toBe(false);
		const elsewhere = await revise(agent, {
			kitchenId: 'k-lounas',
			proposalId: view.proposal.id,
			revision: 0,
			changes: [{ kind: 'removeIngredient', ingredientId: ing.id }]
		});
		expect(elsewhere.ok).toBe(false);
		const readOnly = await revise(
			{ ...agent, scopes: ['read'] },
			{
				kitchenId: 'k-hotel',
				proposalId: view.proposal.id,
				revision: 0,
				changes: [{ kind: 'removeIngredient', ingredientId: ing.id }]
			}
		);
		expect(readOnly.ok).toBe(false);
	});
});
