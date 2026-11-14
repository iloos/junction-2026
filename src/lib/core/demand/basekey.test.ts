import { describe, expect, it } from 'vitest';
import type { Product } from '../contracts';
import { baseKeyOf, substituteKind, whatChanges } from './basekey';

const prov = { source: 'valio_static' as const };
const p = (
	productId: string,
	nameFi: string,
	brand: string | undefined,
	o: {
		category?: string;
		temperatureClass?: Product['temperatureClass'];
		kg?: number;
		l?: number;
	} = {}
) =>
	({
		productId,
		nameFi,
		brand,
		category: o.category ?? '17203',
		temperatureClass: o.temperatureClass ?? 'chilled',
		...(o.kg ? { netPerSalesUnit: { value: { value: o.kg, unit: 'kg' }, provenance: prov } } : {}),
		...(o.l
			? { netVolumePerSalesUnit: { value: { value: o.l, unit: 'l' }, provenance: prov } }
			: {})
	}) as unknown as Product;

const palvi = p('476768', 'HK Palvikinkku viipaloitu 1,5 kg', 'HK', { kg: 1.5 });
const palvi3 = p('476769', 'HK Palvikinkku viipaloitu 3 kg', 'HK', { kg: 3 });
const mattila = p(
	'463159',
	'Mattila Bros. Aito Saunapalvikinkku n.1,8kg, siivutettu',
	'Mattila Bros.',
	{ kg: 1.8 }
);
const vataja = p('476648', 'Vataja noin 1,8kg Maalaiskinkku savustettu pala 1/4', 'Vataja', {
	kg: 1.8
});
const palviWhole = p('476770', 'HK Palvikinkku kokonainen 6 kg', 'HK', { kg: 6 });

describe('baseKeyOf: brand, sizes and form words come out of the name', () => {
	it('keeps the base and the form words', () => {
		expect(baseKeyOf(palvi)).toMatchObject({
			base: 'palvikinkku',
			form: ['viipaloitu'],
			brand: 'HK',
			baseSource: 'parsed'
		});
		expect(baseKeyOf(mattila)).toMatchObject({
			base: 'aito saunapalvikinkku',
			form: ['viipaloitu']
		});
		expect(
			baseKeyOf(p('1', '6 x Saarioinen Perunalaatikko 350g pakaste', 'Saarioinen'))
		).toMatchObject({
			base: 'perunalaatikko',
			form: ['pakaste']
		});
	});

	it('nothing left to compare is unknown, never a guess', () => {
		expect(baseKeyOf(p('2', 'HK 1,5 kg viipaloitu', 'HK'))).toMatchObject({
			base: null,
			baseSource: 'unknown'
		});
	});
});

describe('substituteKind: the ladder, best first', () => {
	it('pack, brand, form, functional, different, unknown', () => {
		expect(substituteKind(palvi, palvi3, false)).toBe('pack');
		expect(substituteKind(palvi, mattila, false)).toBe('brand');
		expect(substituteKind(palvi, palviWhole, false)).toBe('form');
		expect(substituteKind(palvi, vataja, true)).toBe('functional');
		expect(substituteKind(palvi, vataja, false)).toBe('different');
		expect(substituteKind(palvi, p('3', 'HK 2 kg', 'HK'), true)).toBe('unknown');
	});

	it('another category is never the same base', () => {
		const other = p('4', 'HK Palvikinkku viipaloitu 1,5 kg', 'HK', { category: '18710', kg: 1.5 });
		expect(substituteKind(palvi, other, false)).toBe('different');
	});
});

describe('whatChanges: one line from the attribute diff', () => {
	it('names form, brand and pack size, in plain words', () => {
		expect(whatChanges(palvi, vataja)).toBe('smoked, not sliced, Vataja, 1.8 kg packs');
		expect(whatChanges(palvi, mattila)).toBe('Mattila Bros., 1.8 kg packs');
		expect(whatChanges(palvi, palvi3)).toBe('3 kg packs');
	});

	it('liquids by volume, and the temperature when it changes', () => {
		const milk = p('464201', 'Valio kevytmaito 1 l laktoositon UHT', 'Valio', {
			category: '10400',
			kg: 1.031,
			l: 1
		});
		const half = p('464440', 'Valio kevytmaito 0,5 l laktoositon UHT', 'Valio', {
			category: '10400',
			temperatureClass: 'ambient',
			kg: 0.517,
			l: 0.5
		});
		expect(substituteKind(milk, half, false)).toBe('form');
		expect(whatChanges(milk, half)).toBe('ambient, 0.5 l packs');
	});
});
