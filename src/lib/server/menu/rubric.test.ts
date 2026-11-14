/**
 * The acceptance rubric, written before the prompt: on both golden briefs a proposal has every requested course
 * and the brief's covers, amounts that reconcile, every explicit requirement kept, and nothing dropped.
 */
import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import type { MenuProposal } from '$lib/core/contracts';
import { createDbPorts } from '../store/db-ports';
import { goldenBrief } from './golden';
import { fixtureMenu, proposeMenu } from './proposal';
import { blocks, reviewProposal } from './rubric';
import { memoryMenuStore } from './store';

const NOW = new Date('2026-12-07T09:00:00Z');

async function propose(name: string, llm: Llm | null = null) {
	const env = await createDbPorts();
	const store = memoryMenuStore();
	const brief = goldenBrief(name);
	const r = await proposeMenu({
		kitchenId: 'k-hotel',
		workspaceId: 'ws-t',
		brief,
		store,
		catalog: env.ports.catalog,
		now: NOW,
		llm
	});
	return { ...r, brief, store };
}

const clone = (p: MenuProposal) => structuredClone(p);

describe('golden briefs', () => {
	it('five-star: plated, 5 courses, 50 guests, lactose-free and vegetarian:6', () => {
		expect(goldenBrief('five-star')).toMatchObject({
			guests: 50,
			courses: 5,
			serviceStyle: 'plated',
			date: '2026-12-18',
			dietary: ['lactose-free', 'vegetarian:6']
		});
	});
	it('christmas: buffet, 50 guests on 20 December, lactose-free, €2,000', () => {
		expect(goldenBrief('christmas')).toMatchObject({
			guests: 50,
			date: '2026-12-20',
			serviceStyle: 'buffet',
			dietary: ['lactose-free'],
			budgetCents: 200000
		});
	});
});

describe('fixture proposals pass the rubric', () => {
	for (const name of ['five-star', 'christmas'])
		it(`${name}: no blocking issue, every ingredient resolved or said unresolved`, async () => {
			const { proposal, issues, brief } = await propose(name);
			expect(blocks(issues)).toEqual([]);
			expect(proposal).toMatchObject({ revision: 0, status: 'proposed', brief });
			for (const d of proposal.dishes)
				for (const i of d.ingredients) {
					expect([i.productId, i.unresolved].filter(Boolean)).toHaveLength(1);
					expect(i.yield).toBeUndefined();
					expect(i.provenance.source).toBe('team_estimate');
				}
			expect(
				proposal.dishes.flatMap((d) => d.ingredients).filter((i) => i.productId).length
			).toBeGreaterThan(0);
		}, 60_000);

	it('five-star: one dish per course and a vegetarian main for the six', async () => {
		const { proposal } = await propose('five-star');
		expect(proposal.dishes.map((d) => d.course)).toEqual([
			'starter',
			'soup',
			'fish',
			'main',
			'main',
			'dessert'
		]);
		expect(proposal.dishes.find((d) => /risotto/i.test(d.name))?.claimedCompatible).toContain(
			'vegetarian:6'
		);
		expect(proposal.dishes.every((d) => d.claimedCompatible.includes('lactose-free'))).toBe(true);
	}, 60_000);

	it('stores revision 0 before returning, and the same brief returns the stored one', async () => {
		const { proposal, store, brief } = await propose('christmas');
		expect(await store.get('ws-t', proposal.id, 0)).toEqual(proposal);
		const again = await proposeMenu({
			kitchenId: 'k-hotel',
			workspaceId: 'ws-t',
			brief,
			store,
			catalog: {},
			now: NOW
		});
		expect(again.proposal).toEqual(proposal);
	}, 60_000);
});

describe('the rubric catches each failure', () => {
	it('wrong covers, missing courses, dropped requirement, implausible amounts, dropped ids', async () => {
		const { proposal, brief } = await propose('five-star');
		const ids = (p: MenuProposal, prev?: MenuProposal) =>
			blocks(reviewProposal(brief, p, prev)).map((i) => i.id);

		const covers = clone(proposal);
		covers.brief.guests = 40;
		expect(ids(covers)).toContain('covers');

		const courses = clone(proposal);
		courses.dishes = courses.dishes.slice(0, 3);
		expect(ids(courses)).toContain('courses');

		const diet = clone(proposal);
		diet.brief.dietary = ['vegetarian:6'];
		expect(ids(diet)).toContain('diet:lactose-free');

		const claim = clone(proposal);
		claim.dishes[1].claimedCompatible = [];
		expect(ids(claim)).toContain('diet:lactose-free');

		const veg = clone(proposal);
		for (const d of veg.dishes)
			d.claimedCompatible = d.claimedCompatible.filter((c) => c !== 'vegetarian:6');
		expect(ids(veg)).toContain('diet:vegetarian');

		const kg = clone(proposal);
		kg.dishes[0].ingredients[0].amountPerCover = 1200;
		expect(ids(kg)).toContain(`amount:${kg.dishes[0].ingredients[0].id}`);

		const next = clone(proposal);
		next.revision = 1;
		next.dishes = next.dishes.filter((d) => d.course !== 'soup');
		const dropped = ids(next, proposal);
		expect(dropped.some((i) => i.startsWith('dropped:d-root-vegetable-soup'))).toBe(true);
		// The chef may remove a dish: an edit with user provenance is not a drop.
		next.provenance = { source: 'user' };
		expect(ids(next, proposal).filter((i) => i.startsWith('dropped:'))).toEqual([]);
	}, 60_000);

	it('a buffet needs enough dishes; a requirement the menu cannot meet must be said open', () => {
		const brief = goldenBrief('christmas');
		const menu = fixtureMenu({ ...brief, dietary: ['vegan'] });
		expect(menu.open.some((o) => o.startsWith('diet:vegan|'))).toBe(true);
	});
});

describe('model proposals', () => {
	const model = (out: unknown): Llm => ({
		generate: async () => ({
			text: typeof out === 'string' ? out : JSON.stringify(out),
			model: 'gemini-test',
			tokens: { in: 10, out: 20 },
			latencyMs: 5
		})
	});

	it('validates the model JSON, keeps llm provenance and says what the rubric found', async () => {
		const { proposal, issues } = await propose(
			'christmas',
			model({
				dishes: [
					{
						name: 'Joulukinkku',
						course: 'main',
						claimedCompatible: ['lactose-free'],
						ingredients: [{ label: 'ham', query: 'joulukinkku', amountPerCover: 150, unit: 'g' }]
					}
				],
				open: []
			})
		);
		expect(proposal.provenance).toMatchObject({ source: 'llm', ref: 'gemini-test' });
		expect(proposal.dishes[0].ingredients[0].provenance.source).toBe('llm');
		expect(blocks(issues).map((i) => i.id)).toContain('dishes');
	}, 60_000);

	it('falls back to the templates on bad model JSON, and says so', async () => {
		const { proposal, fallback } = await propose('christmas', model('{"dishes": "soup"}'));
		expect(fallback).toMatch(/model proposal failed/);
		expect(proposal.provenance.source).toBe('team_estimate');
		expect(proposal.provenance.note).toMatch(/model proposal failed/);
	}, 60_000);

	it('rejects out-of-bounds amounts from the model', async () => {
		const { fallback } = await propose(
			'christmas',
			model({
				dishes: [
					{
						name: 'x',
						course: 'main',
						ingredients: [{ label: 'ham', query: 'kinkku', amountPerCover: 50000, unit: 'g' }]
					}
				]
			})
		);
		expect(fallback).toMatch(/model proposal failed/);
	}, 60_000);
});
