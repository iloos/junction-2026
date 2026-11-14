import { describe, expect, it } from 'vitest';
import { normalizeProduct } from './normalize';

/** A raw Valio record reduced to what the size fields need. */
const raw = (
	volume: { value: number; unit: string } | null,
	netWeight = { value: 1031, unit: 'GRM' }
) => ({
	productId: '464201',
	salesUnit: 'ST',
	baseUnit: 'ST',
	allowedLotSize: 0.01,
	units: [{ unitId: 'ST', sizeInBaseUnits: 1 }],
	synkkaData: {
		names: [{ language: 'fi', value: 'Valio kevytmaito 1 l laktoositon UHT' }],
		unitConversions: [
			{ synkkaPackagingType: 'BASE_UNIT_OR_EACH', netWeight, ...(volume ? { volume } : {}) }
		]
	}
});
const vol = (r: ReturnType<typeof raw>) =>
	normalizeProduct(r, { co2: new Map(), reliability: new Map() }).netVolumePerSalesUnit;

describe('netVolumePerSalesUnit', () => {
	it("reads Valio's content volume beside the net weight", () => {
		expect(vol(raw({ value: 1, unit: 'LTR' }))?.value).toEqual({ value: 1, unit: 'l' });
		expect(vol(raw({ value: 500, unit: 'MLT' }, { value: 515, unit: 'GRM' }))?.value).toEqual({
			value: 0.5,
			unit: 'l'
		});
	});

	it('ignores a "volume" in grams or pieces, and a unit slip no product could have', () => {
		expect(vol(raw({ value: 1031, unit: 'GRM' }))).toBeUndefined();
		expect(vol(raw({ value: 1, unit: 'H87' }))).toBeUndefined();
		expect(vol(raw({ value: 1000, unit: 'LTR' }, { value: 1, unit: 'KGM' }))).toBeUndefined();
		expect(vol(raw(null))).toBeUndefined();
	});
});

describe('lot step (Valio: allowedLotSize 0.01 means 1)', () => {
	const lot = (salesUnit: string, allowedLotSize: number) =>
		normalizeProduct({ ...raw(null), salesUnit, baseUnit: salesUnit, allowedLotSize }).lotStep;
	it('counted units step by whole units; KG keeps its 10 g step; real lots stay', () => {
		expect(lot('ST', 0.01)).toBe(1);
		expect(lot('KI', 0.01)).toBe(1);
		expect(lot('KG', 0.01)).toBe(0.01);
		expect(lot('KG', 1.5)).toBe(1.5);
		expect(lot('KI', 2)).toBe(2);
	});
});
