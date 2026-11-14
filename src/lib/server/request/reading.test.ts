import { describe, expect, it } from 'vitest';
import { filterHits } from './lookup';
import { parseRules } from './parse';
import { readingOf, reviewReading, statedAmounts } from './reading';

const TODAY = '2026-12-07';
const judge = (text: string) => {
	const p = parseRules(text, TODAY);
	return reviewReading(text, readingOf(p));
};

describe("checkpoint 'request.reading': the reading against the words", () => {
	it('250 ml, 2 dl, 6x1l and 500g are read with the same physical amount and pass', async () => {
		for (const t of ['250 ml milk', '2 dl cream', '6x1l milk', '500g butter']) {
			const v = await judge(t);
			expect(v.kind, t).toBe('pass');
		}
		expect(statedAmounts('250 ml milk')).toMatchObject([{ value: 0.25, unit: 'l' }]);
		expect(statedAmounts('6x1l milk')).toMatchObject([{ value: 6, unit: 'l' }]);
	});

	it('"laktoositon maito 4 pakettia": 4 packs, and lactose-free is a requirement', async () => {
		const p = parseRules('laktoositon maito 4 pakettia', TODAY);
		expect(p.items[0]).toMatchObject({ qty: 4, unit: 'sales', constraints: ['lactose_free'] });
		expect((await judge('laktoositon maito 4 pakettia')).kind).toBe('pass');
	});

	it('"250 zz milk" blocks with the ask, and never reads 250 packs', async () => {
		const p = parseRules('250 zz milk', TODAY);
		expect(p.items[0]).toMatchObject({ qty: null, unit: null, unitToken: 'zz' });
		const v = await judge('250 zz milk');
		expect(v.kind).toBe('block');
		expect(v.kind === 'block' && v.reason).toMatch(/can't order in zz\. How much/);
	});

	it('a reading that lost the amount or a requirement blocks', async () => {
		const lost = await reviewReading('250 ml milk', {
			items: [
				{ id: 'milk', query: 'milk', qty: 250, unit: 'sales', product: 'milk', requirements: [] }
			]
		});
		expect(lost.kind).toBe('block');
		const req = await reviewReading('2 l lactose-free milk', {
			items: [{ id: 'milk', query: 'milk', qty: 2, unit: 'l', product: 'milk', requirements: [] }]
		});
		expect(req.kind === 'block' && req.reason).toMatch(/lactose-free, but no item carries it/);
	});

	it('the echo: 250 ml asked → 1 × 1 l passes; 250 × 1 l blocks', async () => {
		const echo = (salesQty: number) =>
			reviewReading('250 ml milk', {
				items: [],
				echo: [
					{
						item: 'milk',
						asked: { value: 0.25, unit: 'l' },
						salesQty,
						salesUnit: 'ST',
						perUnit: { value: 1, unit: 'l' }
					}
				]
			});
		expect((await echo(1)).kind).toBe('pass');
		const v = await echo(250);
		expect(v.kind === 'block' && v.reason).toMatch(/0\.25 l asked → 250 × 1 l = 250 l/);
	});

	it('a date or a cover count is not an amount; "50 on Friday" is no unit', async () => {
		expect((await judge('200 kg potatoes Friday')).kind).toBe('pass');
		expect(statedAmounts('dinner for 50 on Friday')).toEqual([]);
	});
});

describe('brand and variant: "10 l Arla whole milk" is not just "milk"', () => {
	it('the rules keep Arla and whole, and the reading passes', async () => {
		const [i] = parseRules('10 l Arla whole milk', TODAY).items;
		expect(i).toMatchObject({ qty: 10, unit: 'l', product: 'milk', brand: 'Arla' });
		expect(i.variant?.token).toBe('täysmaito');
		expect(i.search[0]).toMatch(/^arla /);
		expect((await judge('10 l Arla whole milk')).kind).toBe('pass');
	});
	it('a reading that dropped the brand or the variant blocks', async () => {
		const base = {
			id: 'milk',
			query: 'milk',
			qty: 10,
			unit: 'l',
			product: 'milk',
			requirements: []
		};
		const noBrand = await reviewReading('10 l Arla whole milk', {
			items: [{ ...base, variant: 'täysmaito' }]
		});
		expect(noBrand.kind === 'block' && noBrand.reason).toMatch(/names Arla, but no item keeps it/);
		const noVariant = await reviewReading('10 l Arla whole milk', {
			items: [{ ...base, brand: 'Arla', variant: null }]
		});
		expect(noVariant.kind === 'block' && noVariant.reason).toMatch(/says "whole milk"/);
	});
	it('the lookup requires the brand', () => {
		// No amount: the filter alone, no pack sizing.
		const [item] = parseRules('Arla whole milk', TODAY).items;
		const { ranked, rejected } = filterHits(item, [
			{
				productId: '1',
				nameFi: 'Valio täysmaito 1 l',
				brand: 'Valio',
				category: '10400',
				diet: [],
				freeFrom: [],
				labels: []
			} as never,
			{
				productId: '2',
				nameFi: 'Arla täysmaito 1 l',
				brand: 'Arla',
				category: '10400',
				diet: [],
				freeFrom: [],
				labels: []
			} as never
		]);
		expect(ranked.map((r) => r.product.productId)).toEqual(['2']);
		expect(rejected[0].reason).toBe('brand Valio, you asked for Arla');
	});
});
