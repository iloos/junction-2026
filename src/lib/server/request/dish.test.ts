/**
 * Dish requests: "10000 bolognese pasta, half only cow and the other half half" is 10,000 portions of pasta
 * bolognese whose mince is 75% beef and 25% pork, never 10,000 packs of a soy sauce.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { animalsAsked, meatContradiction } from './checks';
import { interpretDish, readDish, readMeatShares } from './dish';
import { filterHits } from './lookup';
import { parseRules } from './parse';
import { runRequest } from './run';

const USER = '10000 bolongese pasta; but with half only cow and other half half';
const PARAPHRASES = [
	'10,000 portions of pasta bolognese, mince half pure beef and the other half mixed',
	'spaghetti bolognese for 10000 servings: half beef mince, the other half beef-pork mix'
];

async function setup() {
	const env = await createDbPorts();
	env.overlay.clear();
	const h = createHandlers(env.ports);
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'kitchen_agent', id: 'a' },
		scopes: SCOPES_BY_ACTOR.kitchen_agent,
		via: 'test'
	};
	const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
	return { h, ctx, kitchen };
}

describe('dish reading: a dish with a count is portions', () => {
	for (const words of [USER, ...PARAPHRASES])
		it(`"${words}" → 10,000 portions of pasta bolognese, 75% beef / 25% pork`, () => {
			const r = readDish(words)!;
			expect(r.dish.key).toBe('bolognese');
			expect(r.portions).toBe(10000);
			expect(r.ask).toBeNull();
			expect(r.mince?.parts).toEqual([
				{ kind: 'beef', share: 0.5 },
				{ kind: 'mixed', share: 0.5 }
			]);
			expect(r.mince?.animal).toEqual({ beef: 0.75, pork: 0.25 });
			expect(r.mince?.line).toMatch(/^Mince: 75% beef, 25% pork, from “/);
		});

	it('a small count with no unit is asked, not assumed', () => {
		const r = readDish('12 bolognese')!;
		expect(r.ask?.question).toBe('12 portions of pasta bolognese?');
		expect(r.ask?.no).toBe('No, 12 packs');
	});

	it('a product word or a physical unit keeps it a product order', () => {
		expect(readDish('20 kg bolognese sauce Friday')).toBeNull();
		expect(readDish('10 bolognesekastike')).toBeNull();
		expect(readDish('40 l milk')).toBeNull();
	});

	it('other ratio wordings', () => {
		expect(readMeatShares('half beef, half pork')?.animal).toEqual({ beef: 0.5, pork: 0.5 });
		expect(readMeatShares('50% beef and 50% mixed')?.animal).toEqual({ beef: 0.75, pork: 0.25 });
		expect(readMeatShares('just beef please')).toBeNull();
	});
});

describe('product checks: a contradicting product is filtered with its reason', () => {
	const p = (nameFi: string, diet: string[] = []) =>
		({ nameFi, diet }) as unknown as Pick<Product, 'nameFi' | 'diet'>;
	it('soy, beans and vegetarian products contradict "cow"', () => {
		const asked = animalsAsked('half only cow');
		expect(asked).toEqual(['beef']);
		expect(meatContradiction(p('Feelia Soijabolognesekastike 600 g'), asked, true)).toBe(
			'a soy product: you asked for beef'
		);
		expect(meatContradiction(p('Tarhurin Papu Bolognesekastike'), asked, true)).toMatch(
			/bean or pea/
		);
		expect(meatContradiction(p('Dolmio Bolognesekastike', ['vegetarian']), asked, true)).toMatch(
			/vegetarian product/
		);
		expect(meatContradiction(p('Snellman naudan jauheliha 17% 2 kg'), asked, true)).toBeNull();
		expect(meatContradiction(p('Kariniemen Kananpojan jauheliha'), asked, true)).toMatch(
			/chicken, not beef/
		);
	});

	it('the lookup never keeps soy for a beef ask', async () => {
		const [item] = parseRules('20 kg beef bolognese sauce', '2026-12-07').items;
		const { ranked, rejected } = filterHits(item, [
			{ productId: '471989', nameFi: 'Feelia Soijabolognesekastike 600 g', diet: [] } as never
		]);
		expect(ranked).toEqual([]);
		expect(rejected[0].reason).toBe('a soy product: you asked for beef');
	});
});

describe('the request flow routes a dish and prices both ways', () => {
	for (const words of [USER, ...PARAPHRASES])
		it(`"${words.slice(0, 40)}…": portions, ratio reasoning, no soy anywhere`, async () => {
			const { h, ctx, kitchen } = await setup();
			const now = new Date('2026-12-07T09:00:00+02:00');
			const d = await interpretDish(words, {
				handlers: h,
				ctx,
				deliverBy: '2026-12-10',
				kitchen,
				now
			});
			expect(d!.portions).toBe(10000);
			expect(d!.reasoning.join('\n')).toMatch(/Mince: 75% beef, 25% pork/);
			const raw = d!.options.find((o) => o.kind === 'raw')!;
			expect(raw.lines.map((l) => l.key)).toEqual([
				'pasta',
				'mince-beef',
				'mince-mixed',
				'tomato',
				'onion',
				'carrot'
			]);
			// 110 g of mince per portion, split by the ratio: 550 kg beef mince, 550 kg mixed.
			expect(raw.lines.find((l) => l.key === 'mince-beef')!.kg).toBe(550);
			const picked = d!.options.flatMap((o) => o.lines.map((l) => l.product?.name ?? ''));
			expect(picked.join()).not.toMatch(/soija|papu|vege/i);
			const ready = d!.options.find((o) => o.kind === 'ready')!;
			expect(ready.lines[0].filtered.map((f) => f.reason).join()).toMatch(/soy product/);
		});

	it('runRequest shows the dish, never 10,000 packs, and holds a dish with a missing line', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest(USER, {
			handlers: h,
			ctx,
			today: '2026-12-07',
			kitchen,
			now: new Date('2026-12-07T09:00:00+02:00'),
			deliverBy: '2026-12-10'
		});
		expect(r.parsed.dish?.portions).toBe(10000);
		expect(r.parsed.items.every((i) => i.unit === 'kg')).toBe(true);
		expect(r.parsed.ambiguities.join()).not.toMatch(/unclear|sales unit/);
		const missing = r.parsed
			.dish!.options.find((o) => o.kind === r.parsed.dishChoice)!
			.lines.some((l) => !l.product);
		if (missing) {
			expect(r.order).toBeNull();
			expect(r.message).toMatch(/^Nothing placed: \d+ of the dish's lines/);
		}
	});

	it('the model path: its "unclear" note about the ratio is replaced by the reasoning', async () => {
		const { h, ctx, kitchen } = await setup();
		const llm: Llm = {
			generate: async () => ({
				text: JSON.stringify({
					items: [{ query: 'bolognese pasta', qty: 10000, unit: 'sales', searchFi: ['bolognese'] }],
					ambiguities: ['half only cow and other half half is unclear']
				}),
				model: 'gemini-test',
				tokens: { in: 1, out: 1 },
				latencyMs: 1
			})
		};
		const r = await runRequest(USER, {
			handlers: h,
			ctx,
			today: '2026-12-07',
			kitchen,
			llm,
			llmKind: 'gemini',
			place: false
		});
		expect(r.parsed.dish).toBeTruthy();
		expect(r.parsed.ambiguities.join()).not.toMatch(/unclear/);
	});
});
