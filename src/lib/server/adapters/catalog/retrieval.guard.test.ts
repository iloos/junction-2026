/** resolve()'s category guards on a small hand-made catalogue (no data/valio needed). */
import { describe, expect, it } from 'vitest';
import { baseForm, RetrievalIndex, type RetrievalProduct } from './retrieval';

let n = 100000;
const P = (
	nameFi: string,
	category: string,
	allergens: { contains: string[]; declared: boolean } = { contains: [], declared: true }
): RetrievalProduct => ({
	productId: String(n++),
	nameFi,
	category,
	categoryGroup: category.slice(0, 2),
	temperatureClass: 'unknown',
	isFood: true,
	freeFrom: [],
	dataQualityFlags: [],
	allergens
});

describe('resolve guards', () => {
	it('a spice term is seasoning even when more of its matches are meat, whatever the catalogue order', () => {
		const ix = new RetrievalIndex([
			P('Mustapippuri jauhettu', '22630'),
			P('Pippuri nauta', '18720'),
			P('Pippuri nauta suikale', '18720'),
			P('Pippuri nauta paisti', '18720')
		]);
		const r = ix.resolve('pippuri');
		expect(r.status).toBe('resolved');
		if (r.status === 'resolved') expect(r.candidates).toHaveLength(1);
	});

	it('names why each nearest product was dropped', () => {
		const ix = new RetrievalIndex([
			P('Lohi tuore', '18701'),
			P('Hunaja kukka', '22150'),
			P('Hunaja maito', '22150', { contains: ['AM'], declared: true })
		]);
		const fish = ix.resolve('lohi', { diet: ['VEGETARIAN'] });
		expect(fish.status === 'unresolved' && fish.nearest.map((x) => x.failed)).toEqual(['diet']);
		const honey = ix.resolve('hunaja', { diet: ['VEGAN'] });
		expect(honey.status === 'unresolved' && honey.nearest.map((x) => x.failed).sort()).toEqual([
			'allergen',
			'diet'
		]);
	});

	it('keeps the named one of "A tai B", and the full word of the prefix form', () => {
		const ix = new RetrievalIndex([
			P('Voi normaalisuolainen', '10500'),
			P('Margariini 60', '10515'),
			P('Kuohukerma 2 dl', '10401'),
			P('Vispikastike', '10401')
		]);
		const butter = ix.resolve('voi tai margariini');
		expect(butter.status === 'resolved' && butter.query).toBe('voi');
		const cream = ix.resolve('2 dl vispi- tai kuohukermaa');
		expect(cream.status).toBe('resolved');
	});

	it('matches a word as typed or in its base form ("suklaa" stays suklaa)', () => {
		expect(baseForm('kermaa')).toBe('kerma');
		expect(baseForm('suklaa')).toBe('sukla');
		const ix = new RetrievalIndex([P('Tumma suklaa 70%', '22601'), P('Suklaa leivonta', '22601')]);
		expect(ix.resolve('suklaa').status).toBe('resolved');
	});
});
