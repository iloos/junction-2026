import { describe, expect, it } from 'vitest';
import { marksOf, marksTitle, rollUp, type DietFacts } from './diet';

const p = (o: Partial<DietFacts> & { contains?: string[]; may?: string[]; declared?: boolean }) =>
	({
		nameFi: o.nameFi ?? 'x',
		allergens: {
			contains: o.contains ?? [],
			mayContain: o.may ?? [],
			declared: o.declared ?? true
		},
		freeFrom: o.freeFrom ?? [],
		diet: o.diet ?? []
	}) satisfies DietFacts;

describe('diet and allergen marks', () => {
	it('reads codes off a declared record and claims', () => {
		expect(marksOf(p({ contains: ['AM'] })).codes).toEqual(['G']);
		expect(marksOf(p({ contains: ['UW', 'AE'] })).codes).toEqual(['L', 'M']);
		expect(marksOf(p({ nameFi: 'Valio kevytmaito laktoositon', contains: ['AM'] })).codes).toEqual([
			'G',
			'L'
		]);
		expect(marksOf(p({ diet: ['vegan'], contains: ['AY'] })).codes).toEqual([
			'G',
			'L',
			'M',
			'VEG',
			'VE'
		]);
	});
	it('never reads free-from off a missing record', () => {
		const m = marksOf(p({ declared: false }));
		expect(m.codes).toEqual([]);
		expect(m.recorded).toBe(false);
		expect(marksTitle(m)).toBe('no allergen record: allergens unknown');
		// A claim still counts without a record: the product says it.
		expect(marksOf(p({ declared: false, freeFrom: ['LACTOSE'] })).codes).toEqual(['L']);
	});
	it('rolls a dish up: codes all lines share, allergens joined, gaps counted', () => {
		const dish = rollUp([
			marksOf(p({ contains: ['AM'] })),
			marksOf(p({ contains: ['UW'] })),
			marksOf(p({ declared: false }))
		]);
		expect(dish.codes).toEqual([]);
		expect(dish.contains).toEqual(['milk', 'wheat']);
		expect(dish.unrecorded).toBe(1);
		expect(marksTitle(dish)).toBe('contains milk, wheat; 1 without an allergen record');
	});
});
