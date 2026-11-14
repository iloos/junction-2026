import { describe, expect, it } from 'vitest';
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
