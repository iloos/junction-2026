import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MenuProposal } from '$lib/core/contracts';
import { createValioCatalog } from '../adapters/catalog/valio';
import { normaliseCourses, type LlmMenu } from './proposal';
import { candidatePool, kitchenPins, pinnedFor, queryVariants } from './resolve';

describe('query variants', () => {
	it('tries the query, the model’s alternatives and a bracketed trade name, in order and without repeats', () => {
		expect(
			queryVariants('porsaankylkirivi', ['ribs', 'Ribs'], 'Porsaan kylkirivi (spare ribs)')
		).toEqual(['porsaankylkirivi', 'ribs', 'spare ribs']);
		expect(queryVariants('a', ['b', 'c', 'd', 'e', 'f']).length).toBeLessThanOrEqual(4);
		expect(queryVariants('juusto', [], 'Cheese (200 g)')).toEqual(['juusto']);
	});
});

describe('what a kitchen settled (read from its recent menus)', () => {
	/** A menu with one ingredient per entry: [words, label, productId?, pinnedBy?, chef turned it down?]. */
	const menu = (
		...ings: [string, string, string | undefined, ('chef' | 'agent' | 'model')?, boolean?][]
	) =>
		({
			dishes: [
				{
					ingredients: ings.map(([ref, label, productId, pinnedBy, down]) => ({
						id: label,
						label,
						amountPerCover: 1,
						unit: 'g',
						...(productId ? { productId } : { unresolved: 'x' }),
						...(pinnedBy ? { pinnedBy } : {}),
						provenance: { source: down ? 'user' : 'llm', ref }
					}))
				}
			]
		}) as unknown as MenuProposal;

	it('finds a pin by its search words or its label; a plain catalogue match is remembered nowhere', () => {
		const pins = kitchenPins([
			menu(['porsaankylki', 'Pork belly', '468362', 'chef'], ['peruna', 'Potato', '111'])
		]);
		expect(pinnedFor(pins, ['pork belly'])).toEqual({ productId: '468362', by: 'chef' });
		expect(pinnedFor(pins, ['PORSAANKYLKI'])).toEqual({ productId: '468362', by: 'chef' });
		expect(pinnedFor(pins, ['peruna'])).toBeUndefined();
	});

	it('a person’s pin beats a newer model pick; the newest of equals wins', () => {
		const newest = menu(['sipuli', 'Onion', 'model-new', 'model']);
		const older = menu(['sipuli', 'Onion', 'agent-old', 'agent']);
		const oldest = menu(['sipuli', 'Onion', 'chef-oldest', 'chef']);
		expect(pinnedFor(kitchenPins([newest, older, oldest]), ['sipuli'])?.productId).toBe(
			'agent-old'
		);
		expect(pinnedFor(kitchenPins([newest]), ['sipuli'])?.productId).toBe('model-new');
	});

	it('a product the chef turned down later is no longer reused', () => {
		const later = menu(['sipuli', 'Onion', undefined, undefined, true]);
		const earlier = menu(['sipuli', 'Onion', 'chef-pick', 'chef']);
		expect(pinnedFor(kitchenPins([later, earlier]), ['sipuli'])).toBeUndefined();
		expect(pinnedFor(kitchenPins([earlier, later]), ['sipuli'])?.productId).toBe('chef-pick');
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
