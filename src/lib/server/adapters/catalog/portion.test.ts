/**
 * Ingredients for a kitchen resolve to kitchen packs: sugar for a 1000-guest menu is a 1 kg or 25 kg bag, not 500
 * sachets of 5 g. Asking for portions still finds them.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadCatalogue } from './valio';
import { RetrievalIndex, toRetrievalProduct } from './retrieval';

describe.skipIf(!existsSync('data/valio/valio_aimo_junction26_product_data.json'))(
	'portion packs',
	() => {
		const cat = existsSync('data/valio/valio_aimo_junction26_product_data.json')
			? loadCatalogue('data/valio')
			: new Map();
		const ix = new RetrievalIndex([...cat.values()].map(toRetrievalProduct));
		const SACHETS = ['465354', '464167']; // Segafredo 500x5g, Urtekram 4,5g x 800
		const first = (q: string) => {
			const r = ix.resolve(q, { limit: 3 });
			return r.status === 'resolved' ? r.candidates.map((c) => c.productId) : [];
		};
		it('sugar resolves to a kitchen pack first', () => {
			const ids = first('sokeri');
			expect(ids.length).toBeGreaterThan(0);
			expect(SACHETS).not.toContain(ids[0]);
		});
		it('asking for portions still finds the sachets', () => {
			expect(first('sokeri annospakkaus').some((id) => SACHETS.includes(id))).toBe(true);
		});
	}
);
