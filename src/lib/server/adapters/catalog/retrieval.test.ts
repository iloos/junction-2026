import { describe, expect, it } from 'vitest';
import {
	assemble,
	contentWords,
	RetrievalIndex,
	wordSim,
	type RetrievalProduct
} from './retrieval';

const p = (
	productId: string,
	nameFi: string,
	o: Partial<RetrievalProduct> = {}
): RetrievalProduct => ({
	productId,
	nameFi,
	category: '18760',
	categoryGroup: '18',
	temperatureClass: 'chilled',
	isFood: true,
	freeFrom: [],
	dataQualityFlags: [],
	...o
});

describe('retrieval words', () => {
	it('drops pack sizes, units, origin and brand words; maps synonyms and genitives', () => {
		expect(contentWords('Snellman Kunnon naudan jauheliha 17% 2 kg', 'Snellman')).toEqual([
			'kunno',
			'nauta',
			'jauheliha'
		]);
		expect(contentWords('SIPULI 10KG SÄKKI SUOMI')).toEqual(['sipuli']);
		expect(contentWords('Kariniemen Kananpojan rintafilee maustamaton', 'Kariniemen')).toEqual([
			'kana',
			'rintafilee',
			'maustamaton'
		]);
	});

	it('scores Finnish compound heads', () => {
		expect(wordSim('kinkku', 'palvikinkku')).toBe(0.8);
		expect(wordSim('juhlakinkku', 'palvikinkku')).toBe(0.6);
		expect(wordSim('sipuli', 'porkkana')).toBe(0);
	});
});

describe('hybrid candidates', () => {
	const mince = p('1', 'Naudan jauheliha 17% 2 kg', { freeFrom: ['LACTOSE', 'GLUTEN'] });
	const all = [
		mince,
		p('2', 'Atria Naudan Jauheliha 10% 2kg', { brand: 'Atria' }),
		p('3', 'Naudan sisäfilee tuore'),
		p('4', 'Kypsä naudan jauheliha pakaste', { temperatureClass: 'frozen', category: '41702' }),
		p('5', 'Jauheliha-perunalaatikko 600g', { category: '17300' }),
		p('6', 'Kevytmaito laktoositon 1 l', { category: '10400', categoryGroup: '10' }),
		p('7', 'Kevytmaito 1 l', { category: '10400', categoryGroup: '10' }),
		p('8', 'Naudan jauheliha vanha', { dataQualityFlags: ['old_flagged_name'] }),
		p('9', 'Kevytmaito laktoositon 1 l non-food', { isFood: false })
	];
	const ix = new RetrievalIndex(all);

	it('ranks the plain same item first and processed or composite items after it', () => {
		const ids = ix.similar(mince, new Set(['1']), 10).map((c) => c.productId);
		expect(ids[0]).toBe('2');
		expect(ids.indexOf('4')).toBeGreaterThan(ids.indexOf('2'));
		expect(ids).not.toContain('8');
	});

	it('naturally lactose-free data does not demand lactose-free; a lactose-free name does', () => {
		expect(ix.similar(mince, new Set(['1']), 10).map((c) => c.productId)).toContain('2');
		const ids = ix.similar(all[5], new Set(['6']), 10).map((c) => c.productId);
		expect(ids).not.toContain('7');
		expect(ids).not.toContain('9');
	});

	it('needs a real name match: the same category alone never qualifies', () => {
		const ids = ix.similar(p('x', 'Possun kylki'), new Set(['x']), 10).map((c) => c.productId);
		expect(ids).toEqual([]);
	});

	it('keeps Valio rules first and never cuts them', () => {
		const t = { ...mince, valioSubstitutes: ['3', '404'] };
		const got = assemble(
			t,
			(id) => id !== '404',
			(ex, room) => ix.similar(mince, ex, room),
			2
		);
		expect(got.map((c) => [c.productId, c.reason])).toEqual([
			['3', 'rule'],
			['2', 'name']
		]);
	});
});

describe('resolve (menu ingredient queries)', () => {
	const all = [
		p('1', 'Naudan jauheliha 17% 2 kg'),
		p('2', 'Kuohukerma 1 l', { category: '10401', categoryGroup: '10' }),
		p('3', 'Kevytmaito 1 l', { category: '10400', categoryGroup: '10' }),
		p('4', 'Kevytmaito laktoositon 1 l', { category: '10400', categoryGroup: '10' })
	];
	const ix = new RetrievalIndex(all);

	it('resolves a matching query, best first', () => {
		const r = ix.resolve('naudan jauheliha');
		expect(r.status).toBe('resolved');
		if (r.status === 'resolved') expect(r.candidates[0].productId).toBe('1');
	});

	it('says which constraint failed when names match but the diet does not', () => {
		const r = ix.resolve('kuohukerma', { diet: ['LACTOSE'] });
		expect(r).toMatchObject({
			status: 'unresolved',
			reason: 'products match "kuohukerma" but none is lactose-free',
			nearest: [{ productId: '2', failed: 'LACTOSE' }]
		});
		const ok = ix.resolve('laktoositon kevytmaito');
		expect(ok.status === 'resolved' && ok.candidates.map((c) => c.productId)).toEqual(['4']);
	});

	it('stays unresolved instead of taking a weak substring hit', () => {
		// "liha" is only part of the query: the mince is offered as nearest, never as the answer.
		expect(ix.resolve('yksisarvisen liha')).toMatchObject({
			status: 'unresolved',
			nearest: [{ productId: '1', failed: 'match' }]
		});
		expect(ix.resolve('2 kg suomi')).toMatchObject({ status: 'unresolved' });
	});
});
