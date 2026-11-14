import { describe, expect, it } from 'vitest';
import type { Product } from '../contracts';
import { convertAmount, densityOf, toMeasure } from './convert';

const prov = { source: 'valio_static' as const };
const milk = {
	productId: '464201',
	nameFi: 'Valio kevytmaito 1 l laktoositon UHT',
	netPerSalesUnit: { value: { value: 1.031, unit: 'kg' }, provenance: prov },
	netVolumePerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: prov }
} as unknown as Product;
const noVolume = { ...milk, netVolumePerSalesUnit: undefined } as Product;

describe('toMeasure: fixed factors within a dimension', () => {
	it('reduces g, ml, cl and dl', () => {
		expect(toMeasure(500, 'g')).toEqual({ value: 0.5, unit: 'kg' });
		expect(toMeasure(5, 'dl')).toEqual({ value: 0.5, unit: 'l' });
		expect(toMeasure(33, 'cl')).toEqual({ value: 0.33, unit: 'l' });
		expect(toMeasure(250, 'ml')).toEqual({ value: 0.25, unit: 'l' });
	});
});

describe('convertAmount', () => {
	it('same dimension needs no product', () => {
		expect(convertAmount(2500, 'g', 'kg')).toMatchObject({
			ok: true,
			via: 'fixed',
			amount: { value: 2.5, unit: 'kg' }
		});
	});

	it("kg ↔ l uses this product's own density, with its source", () => {
		const c = convertAmount(20, 'kg', 'l', milk);
		expect(c).toMatchObject({ ok: true, via: 'density', amount: { value: 19.399, unit: 'l' } });
		expect(c.ok && c.note).toContain('1.031 kg per 1 l');
		expect(convertAmount(10, 'l', 'kg', milk)).toMatchObject({
			ok: true,
			amount: { value: 10.31, unit: 'kg' }
		});
	});

	it('never assumes water: no stated volume is a question', () => {
		expect(densityOf(noVolume)).toBeNull();
		expect(convertAmount(20, 'kg', 'l', noVolume)).toMatchObject({
			ok: false,
			reason: 'no_density'
		});
		expect(convertAmount(20, 'kg', 'l')).toMatchObject({ ok: false, reason: 'no_density' });
	});

	it('pieces never convert', () => {
		expect(convertAmount(12, 'pcs', 'kg', milk)).toMatchObject({ ok: false, reason: 'pieces' });
	});
});
