/** A case named "100G … 12KPL" holds twelve of the stated size; "30kpl 1,8kg" states the total. */
import { describe, expect, it } from 'vitest';
import type { Product } from '../contracts';
import { contentPerSalesUnit } from './content';

const p = (nameFi: string, salesUnit = 'KI', packs = [{ unit: 'KI', baseUnits: 1 }]) =>
	({
		nameFi,
		salesUnit,
		baseUnit: salesUnit,
		packs,
		netPerSalesUnit: undefined
	}) as unknown as Product;

describe('a trailing piece count', () => {
	it('JÄÄSALAATTI 100G SUOMI 12KPL is 1.2 kg a case', () => {
		const c = contentPerSalesUnit(p('JÄÄSALAATTI 100G SUOMI 12KPL'), 'kg');
		expect('value' in c && c.value).toBe(1.2);
	});
	it('a count before the size is the pieces inside the stated total', () => {
		const c = contentPerSalesUnit(p('Kananmuna 30kpl 1,8kg'), 'kg');
		expect('value' in c && c.value).toBe(1.8);
	});
	it('no count, no change', () => {
		const c = contentPerSalesUnit(p('Valio voi 500 g', 'ST', [{ unit: 'ST', baseUnits: 1 }]), 'kg');
		expect('value' in c && c.value).toBe(0.5);
	});
});
