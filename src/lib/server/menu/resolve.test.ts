import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createValioCatalog } from '../adapters/catalog/valio';
import { normaliseCourses, type LlmMenu } from './proposal';
import { candidatePool, clearPins, pinnedFor, queryVariants, rememberPin } from './resolve';

describe('query variants', () => {
	it('tries the query, the model’s alternatives and a bracketed trade name, in order and without repeats', () => {
		expect(
			queryVariants('porsaankylkirivi', ['ribs', 'Ribs'], 'Porsaan kylkirivi (spare ribs)')
		).toEqual(['porsaankylkirivi', 'ribs', 'spare ribs']);
		expect(queryVariants('a', ['b', 'c', 'd', 'e', 'f']).length).toBeLessThanOrEqual(4);
		expect(queryVariants('juusto', [], 'Cheese (200 g)')).toEqual(['juusto']);
	});
});

describe('what a kitchen settled', () => {
	afterEach(clearPins);
	it('finds a pin by any of its words, only in the same workspace and kitchen', () => {
		rememberPin('ws-1', 'k-a', ['porsaankylki', 'Pork belly'], '468362', 'chef');
		expect(pinnedFor('ws-1', 'k-a', ['pork belly'])).toEqual({ productId: '468362', by: 'chef' });
		expect(pinnedFor('ws-1', 'k-b', ['porsaankylki'])).toBeUndefined();
		expect(pinnedFor('ws-2', 'k-a', ['porsaankylki'])).toBeUndefined();
	});
	it('a model’s choice never replaces a chef’s or agent’s pin; a person’s pin replaces anything', () => {
		rememberPin('ws', 'k', ['sipuli'], 'chef-pick', 'chef');
		rememberPin('ws', 'k', ['sipuli'], 'model-pick', 'model');
		expect(pinnedFor('ws', 'k', ['sipuli'])?.productId).toBe('chef-pick');
		rememberPin('ws', 'k', ['sipuli'], 'agent-pick', 'agent');
		expect(pinnedFor('ws', 'k', ['sipuli'])?.productId).toBe('agent-pick');
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
		expect(normaliseCourses(menu, { courses: 4 }).dishes.map((x) => x.course)).toContain('side');
		expect(normaliseCourses(menu, {})).toBe(menu);
	});
});

const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));

/**
 * The 14 Nov dinner's misses: the right product must be in the chooser's candidates (the choice itself is the model's,
 * covered in choose.test.ts with a stub). Generic cases, no word lists: the pool is the resolver's own answers.
 */
describe.skipIf(!hasData)('candidate pool on the real catalogue', () => {
	const cat = createValioCatalog({});
	const one = (q: string) => cat.resolve!(q, { limit: 3 });
	const pool = async (query: string, alt: string[], label: string) => {
		const ids = await candidatePool(one, { query, alt, label });
		return [...(await cat.get(ids)).values()].map((p) => p.nameFi);
	};
	it.each([
		['keltasipuli', ['sipuli'], 'Yellow onion', /^sipuli \d+kg/i],
		['chipotle adobo', ['chipotle'], 'Chipotle in adobo', /adobo/i],
		['wonton', ['won ton'], 'Wonton wrappers', /won ton/i],
		['porsaankylki', ['porsaan kylki'], 'Pork belly', /porsaan kylki/i],
		['limettimehu', ['limetti mehu'], 'Lime juice', /limettitäysmehu/i],
		['porsaan kylkirivi', [], 'Pork ribs (ribs)', /ribs/i]
	])('"%s" has the right product among its candidates', async (q, alt, label, want) => {
		expect((await pool(q, alt, label)).some((n) => want.test(n))).toBe(true);
	});
});
