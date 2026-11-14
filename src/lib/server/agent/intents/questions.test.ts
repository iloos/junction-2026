import { describe, expect, it } from 'vitest';
import { ok, Product } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { createGetContext } from '../get-context';
import { trialWorkspace } from '../trial-harness';
import { answerQuestion, readChoice, readQuestion } from './questions';

describe('readQuestion', () => {
	it.each([
		["What's my cap?", { kind: 'mandate' }],
		['What can you order on your own?', { kind: 'mandate' }],
		['Mikä on valtuutus?', { kind: 'mandate' }],
		[
			'Is the Valio whipping cream recalled?',
			{ kind: 'product', aspect: 'recall', query: 'Valio whipping cream' }
		],
		['Where is the butter from?', { kind: 'product', aspect: 'origin', query: 'butter' }],
		[
			'Does kermavaahto contain gluten?',
			{ kind: 'product', aspect: 'allergens', query: 'kermavaahto gluten' }
		],
		['Tell me about Oltermanni', { kind: 'product', aspect: 'facts', query: 'Oltermanni' }]
	])('%s', (text, want) => {
		expect(readQuestion(text)).toEqual(want);
	});

	it.each([
		'Order 4 kg butter for Friday',
		'Raise the cap to 2000',
		'Approve it',
		'What still needs my decision?',
		'Is the order recalled?',
		'Plan the Christmas buffet for 140',
		'salmon is short, repair the plan'
	])('leaves "%s" to the agent', (text) => {
		expect(readQuestion(text)).toBeNull();
	});
});

describe('answerQuestion', () => {
	it(
		'answers the mandate in the chef’s words with the enforced numbers, read-only',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			// get_context is served by the server layer; wired here as tools/handlers.ts does.
			const handlers = {
				...w.handlers,
				get_context: createGetContext(w.env.ports)
			} as ToolHandlers;
			const a = await answerQuestion({ kind: 'mandate' }, w.ctx('kitchen_agent'), handlers, {
				kitchenId: 'k-hotel'
			});
			expect(a.text).toContain('Hotel');
			expect(a.text).toMatch(/“.+”/);
			expect(a.text).toContain('€800 a line');
			expect(a.text).toContain('Only a chef changes the mandate');
			expect(a.steps.map((s) => s.tool)).toEqual(['get_context']);
			expect(w.ops).toHaveLength(0);
		}
	);

	it(
		'answers a product question from the catalogue first and never writes',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const q = readQuestion('Does kermavaahto contain milk?')!;
			const a = await answerQuestion(q, w.ctx('kitchen_agent'), w.handlers);
			expect(a.steps[0].tool).toBe('search_products');
			expect(a.text.length).toBeGreaterThan(10);
			for (const s of a.steps)
				expect(['search_products', 'check_recall', 'lookup_facts']).toContain(s.tool);
			expect(w.ops).toHaveLength(0);
		}
	);

	it('finds butter as butter (voi), never butternut squash', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'origin', query: 'butter' },
			w.ctx('kitchen_agent'),
			w.handlers
		);
		expect(a.steps[0].summary.toLowerCase()).not.toContain('butternut');
		expect(a.text.toLowerCase()).not.toContain('butternut');
		expect(a.text).not.toMatch(/ from [a-z]{2},/);
	});

	it('says plainly when no product matches', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'recall', query: 'zzqx unicorn steak' },
			w.ctx('kitchen_agent'),
			w.handlers
		);
		expect(a.text).toContain('no product');
		expect(a.sources).toEqual([]);
	});
});

/** Two real catalogue products relabelled as the round-10 probe's milks: Valio semi-skimmed (FI), Arla whole (SE). */
async function milks() {
	const w = await trialWorkspace();
	const ctx = w.ctx('kitchen_agent');
	const s = await w.handlers.search_products(ctx, { query: 'maito', limit: 2 });
	if (!s.ok) throw new Error(s.error.message);
	const [a, b] = s.value.products;
	const products = [
		Product.parse({
			...a,
			nameFi: 'Valio kevytmaito 1 l',
			nameEn: 'Valio semi-skimmed milk',
			brand: 'Valio',
			category: '10400',
			origin: 'fi'
		}),
		Product.parse({
			...b,
			nameFi: 'Arla täysmaito 1 l',
			nameEn: 'Arla whole milk',
			brand: 'Arla',
			category: '10400',
			origin: 'se'
		})
	];
	const handlers = {
		...w.handlers,
		search_products: async () => ok({ products })
	} as ToolHandlers;
	return { w, ctx, handlers, products };
}

describe('R10-15: a named product is that product, or the chef picks', () => {
	it(
		'“Is the Arla whole milk Finnish?” answers for Arla whole milk (Sweden), never the default',
		{ timeout: 60_000 },
		async () => {
			const { ctx, handlers } = await milks();
			const q = readQuestion('Is the Arla whole milk Finnish?');
			expect(q).toMatchObject({ kind: 'product', aspect: 'origin' });
			const a = await answerQuestion(q!, ctx, handlers);
			expect(a.text).toContain('Arla whole milk');
			expect(a.text).toContain('Sweden');
			expect(a.text).not.toContain('semi-skimmed');
		}
	);

	it(
		'“Where is the milk from?” asks which one before answering, and answers the pick',
		{ timeout: 60_000 },
		async () => {
			const { ctx, handlers, products } = await milks();
			const a = await answerQuestion(readQuestion('Where is the milk from?')!, ctx, handlers);
			expect(a.text).toContain('Which one?');
			expect(a.text).not.toMatch(/comes from/);
			expect(a.choices?.map((c) => c.label)).toEqual([
				'Valio semi-skimmed milk',
				'Arla whole milk'
			]);
			const pick = readChoice(a.choices![1].value)!;
			expect(pick).toMatchObject({ aspect: 'origin', productId: products[1].productId });
			const b = await answerQuestion(
				{ kind: 'product', aspect: pick.aspect, query: pick.name, productId: pick.productId },
				ctx,
				handlers
			);
			expect(b.text).toBe("Arla whole milk comes from Sweden, according to Valio's catalogue.");
		}
	);

	it(
		'answers for every match at once when they all share an origin',
		{ timeout: 60_000 },
		async () => {
			const { ctx, handlers, products } = await milks();
			const same = products.map((p) => ({ ...p, origin: 'fi' }));
			const a = await answerQuestion(readQuestion('Where is the milk from?')!, ctx, {
				...handlers,
				search_products: async () => ok({ products: same })
			} as ToolHandlers);
			expect(a.text).toMatch(/^All 2 matching products come from Finland/);
			expect(a.choices).toBeUndefined();
		}
	);

	it('never reports a drill as a recall', { timeout: 60_000 }, async () => {
		const { ctx, handlers } = await milks();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'recall', query: 'Arla whole milk' },
			ctx,
			{
				...handlers,
				check_recall: async () =>
					ok({
						notices: [
							{
								url: 'https://www.ruokavirasto.fi/drill',
								title: 'Drill: milk recall',
								match: 'gtin' as const,
								drill: true,
								seenAt: '2026-12-07T10:00:00Z'
							}
						]
					})
			} as ToolHandlers
		);
		expect(a.text).toMatch(/^No recall found in the notices we monitor/);
		expect(a.text).toContain('drill');
		expect(a.steps.find((s) => s.tool === 'check_recall')?.source).toBe('cache');
	});

	it('labels a web fact with its real source, not always live', { timeout: 60_000 }, async () => {
		const { ctx, handlers } = await milks();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'facts', query: 'Arla whole milk' },
			ctx,
			{
				...handlers,
				lookup_facts: async () =>
					ok({ facts: [], cached: false, meta: { summary: '[replay] No recorded answer.' } })
			} as ToolHandlers
		);
		expect(a.steps.find((s) => s.tool === 'lookup_facts')?.source).toBe('replay');
	});
});
