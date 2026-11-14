/**
 * Independent review F1: a schema-valid model reading may never rewrite the purchase. Each injected answer below is
 * valid JSON for the Understanding schema; whatever it changes against the chef's words (amount, unit, date, a dropped
 * requirement, diet or brand, a missing, extra or swapped item), the chef's own words are what runs, and the guard
 * names the change. A faithful rewrite (a misspelling fixed) still runs.
 */
import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { reconcile, understand } from './understand';

const TODAY = '2026-12-07';

const llm = (reply: unknown): Llm => ({
	async generate() {
		return {
			text: JSON.stringify(reply),
			model: 'gemini-test',
			tokens: { in: 1, out: 1 },
			latencyMs: 1
		};
	}
});

const order = (...items: object[]) => ({ kind: 'order', items });

const CASES: { words: string; reply: unknown; changed: RegExp }[] = [
	{
		words: '4 kg lactose-free butter tomorrow',
		reply: order({ product: 'butter', amount: 40, unit: 'kg', date: 'tomorrow' }),
		changed: /amount of .*butter.*4 → 40/
	},
	{
		words: '4 kg lactose-free butter tomorrow',
		reply: order({ product: 'butter', amount: 4, unit: 'kg', date: 'tomorrow' }),
		changed: /requirements of .*lactose_free dropped/
	},
	{
		words: '4 kg butter tomorrow',
		reply: order({ product: 'butter', amount: 4, unit: 'l', date: 'tomorrow' }),
		changed: /unit of butter/
	},
	{
		words: '4 kg butter tomorrow',
		reply: order({ product: 'butter', amount: 4, unit: 'kg', date: 'Friday' }),
		changed: /delivery day/
	},
	{
		words: '2 kg potatoes and 2 kg carrots tomorrow',
		reply: order({ product: 'potatoes', amount: 2, unit: 'kg', date: 'tomorrow' }),
		changed: /number of items \(2 → 1\)/
	},
	{
		words: '2 kg potatoes tomorrow',
		reply: order(
			{ product: 'potatoes', amount: 2, unit: 'kg', date: 'tomorrow' },
			{ product: 'butter', amount: 5, unit: 'kg' }
		),
		changed: /number of items \(1 → 2\)/
	},
	{
		words: '2 kg potatoes and 5 l milk tomorrow',
		reply: order(
			{ product: 'potatoes', amount: 5, unit: 'l' },
			{ product: 'milk', amount: 2, unit: 'kg', date: 'tomorrow' }
		),
		changed: /amount of potatoes|unit of potatoes/
	},
	{
		words: '3 kg Valio butter tomorrow',
		reply: order({ product: 'butter', amount: 3, unit: 'kg', date: 'tomorrow' }),
		changed: /brand/
	}
];

describe('F1: the model may not rewrite the purchase', () => {
	for (const c of CASES)
		it(`"${c.words}" stays the chef's words`, async () => {
			const u = await understand(c.words, { today: TODAY, llm: llm(c.reply) });
			expect(u.goal).toBe(c.words);
			expect(u.guard).toMatch(c.changed);
		});

	it('a faithful rewrite still runs (a misspelling fixed, same amounts)', async () => {
		const u = await understand('4 kg lactose-free buttr tomorrow', {
			today: TODAY,
			llm: llm(
				order({
					product: 'butter',
					amount: 4,
					unit: 'kg',
					date: 'tomorrow',
					constraints: ['lactose_free']
				})
			)
		});
		expect(u.guard).toBeUndefined();
		expect(u.goal).toBe('4 kg lactose-free butter tomorrow');
	});

	it('reconcile is one to one: one item never answers two asks', () => {
		expect(
			reconcile(
				'2 kg potatoes and 2 kg carrots tomorrow',
				'2 kg potatoes and 2 kg potatoes tomorrow',
				TODAY
			)
		).toMatch(/carrots|products/);
	});
});
