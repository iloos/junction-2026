import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createValioCatalog } from '../adapters/catalog/valio';
import { normaliseCourses, resolveMenuIngredient, type LlmMenu } from './proposal';
import { clearPins, pinnedFor, queryVariants, rememberPin, splitCompound } from './resolve';

describe('query variants', () => {
	it('splits genitive cuts and head-noun compounds into the catalogue’s two-word forms', () => {
		expect(splitCompound('porsaankylki')).toContain('porsaan kylki');
		expect(splitCompound('limettimehu')).toContain('limetti mehu');
		expect(splitCompound('keltasipuli')).toContain('kelta sipuli');
		expect(splitCompound('porsaan kylki')).toEqual([]);
		expect(splitCompound('voi')).toEqual([]);
	});

	it('tries the query first, then splits, the model’s alternatives and a bracketed trade name, without repeats', () => {
		expect(
			queryVariants('porsaankylkirivi', ['ribs', 'Ribs'], 'Porsaan kylkirivi (spare ribs)')
		).toEqual(['porsaankylkirivi', 'porsaan kylkirivi', 'ribs', 'spare ribs']);
		expect(queryVariants('a', ['b', 'c', 'd', 'e', 'f']).length).toBeLessThanOrEqual(5);
	});
});

describe('pins remembered per kitchen', () => {
	afterEach(clearPins);
	it('finds a pin by any of its words, only in the same workspace and kitchen', () => {
		rememberPin('ws-1', 'k-a', ['porsaankylki', 'Pork belly'], '468362');
		expect(pinnedFor('ws-1', 'k-a', ['pork belly'])).toBe('468362');
		expect(pinnedFor('ws-1', 'k-b', ['porsaankylki'])).toBeUndefined();
		expect(pinnedFor('ws-2', 'k-a', ['porsaankylki'])).toBeUndefined();
	});
});

describe('courses', () => {
	const dish = (course: string) => ({
		name: course,
		course,
		claimedCompatible: [],
		ingredients: [{ label: 'x', query: 'x', amountPerCover: 1, unit: 'g', alt: [] }]
	});
	it('turns sides into mains only while the requested courses are short', () => {
		const menu = {
			dishes: ['starter', 'fish', 'side', 'side', 'dessert'].map(dish),
			open: []
		} as LlmMenu;
		expect(normaliseCourses(menu, { courses: 5 }).dishes.map((x) => x.course)).toEqual([
			'starter',
			'fish',
			'main',
			'main',
			'dessert'
		]);
		expect(normaliseCourses(menu, { courses: 4 }).dishes.map((x) => x.course)).toEqual([
			'starter',
			'fish',
			'main',
			'side',
			'dessert'
		]);
		expect(normaliseCourses(menu, {})).toBe(menu);
	});
});

const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));

describe.skipIf(!hasData)('variants on the real catalogue (14 Nov dinner)', () => {
	const cat = createValioCatalog({});
	const name = async (r: Awaited<ReturnType<typeof resolveMenuIngredient>>) =>
		r?.resolution.status === 'resolved'
			? (await cat.get([r.resolution.candidates[0].productId])).get(
					r.resolution.candidates[0].productId
				)?.nameFi
			: undefined;

	it('resolves a compound the resolver misses through its split, and says which words matched', async () => {
		const r = await resolveMenuIngredient(cat, {
			query: 'porsaankylki',
			label: 'Pork belly',
			flags: []
		});
		expect(r?.via).toBe('porsaan kylki');
		expect(await name(r)).toMatch(/kylki/i);
		const lime = await resolveMenuIngredient(cat, {
			query: 'limettimehu',
			label: 'Lime juice',
			flags: []
		});
		expect(await name(lime)).toMatch(/limetti/i);
	});

	it('finds won ton sheets through the model’s alternative', async () => {
		const r = await resolveMenuIngredient(cat, {
			query: 'wonton',
			alt: ['won ton'],
			label: 'Wonton wrappers',
			flags: []
		});
		expect(await name(r)).toMatch(/won ton/i);
	});

	it('never pins ground onion for "keltasipuli" through the plain noun', async () => {
		const r = await resolveMenuIngredient(cat, {
			query: 'keltasipuli',
			alt: ['sipuli'],
			label: 'Yellow onion',
			flags: []
		});
		expect((await name(r)) ?? '').not.toMatch(/jauhe|jauhettu|ruohosipuli/i);
	});

	it('never pins chilli powder for "chipotle adobo" through the plain "chipotle"', async () => {
		const r = await resolveMenuIngredient(cat, {
			query: 'chipotle adobo',
			alt: ['chipotle'],
			label: 'Chipotle in adobo',
			flags: []
		});
		expect((await name(r)) ?? 'adobo').toMatch(/adobo/i);
	});

	it('a remembered pin answers first, unless it breaks a whole-menu flag', async () => {
		const r = await resolveMenuIngredient(cat, {
			query: 'porsaan kylkirivi',
			label: 'Ribs',
			flags: [],
			pinned: { productId: '462201', source: 'remembered' }
		});
		expect(r?.pinned).toBe('remembered');
		// Regular smetana (464773 is lactose-free; find a plain one) must not pass a lactose-free menu as a pin.
		const plain = await resolveMenuIngredient(cat, {
			query: 'kuohukerma',
			label: 'Cream',
			flags: ['LACTOSE'],
			pinned: { productId: '469050', source: 'hint' }
		});
		expect(plain?.pinned).toBeUndefined();
	});
});
