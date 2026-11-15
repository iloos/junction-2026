/**
 * search_products for a chef's words (prod, 15 Nov: "steaks", "100 streaks", "cow meat" and "2kg cow" found nothing).
 * English and colloquial words read as the catalogue's, typos corrected, amounts dropped; the best few come back with
 * a confidence and what was searched for, so the chat can ask "Did you mean…?".
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadCatalogue } from './valio';
import { RetrievalIndex, toRetrievalProduct, usesSearchWords } from './retrieval';

const BEEF = /naudan|nauta|entrec|sisäfile|ulkofile|beef/i;

describe.skipIf(!existsSync('data/valio/valio_aimo_junction26_product_data.json'))(
	'tolerant search',
	() => {
		const cat = existsSync('data/valio/valio_aimo_junction26_product_data.json')
			? loadCatalogue('data/valio')
			: new Map();
		const ix = new RetrievalIndex([...cat.values()].map(toRetrievalProduct));
		const names = (q: string) => {
			const r = ix.searchTolerant(q, 5);
			return { r, names: r.hits.map((h) => cat.get(h.productId)?.nameFi ?? '') };
		};

		it.each(['steaks', '100 streaks', 'cow meat', '2kg cow'])('%s finds beef', (q) => {
			const { r, names: n } = names(q);
			expect(n.length).toBeGreaterThanOrEqual(3);
			expect(BEEF.test(n[0])).toBe(true);
			expect(r.hits[0].confidence).toBeGreaterThan(0.45);
		});

		it('a typo is corrected and lowers the confidence', () => {
			const exact = names('steaks').r;
			const typo = names('100 streaks').r;
			expect(typo.corrected).toMatch(/streaks → steak/);
			expect(typo.hits[0].confidence).toBeLessThan(exact.hits[0].confidence);
		});

		it('steak is beef cuts, never a beef tomato', () => {
			for (const n of names('steaks').names) expect(n).not.toMatch(/tomaatti/i);
		});

		it('a word nobody knows is never confident: "flurbleberry jam" stays below the asking bar', () => {
			const r = names('4 kg flurbleberry jam').r;
			for (const h of r.hits) expect(h.confidence).toBeLessThan(0.45);
		});

		it('English words go to the tolerant search; Finnish ones keep the exact search', () => {
			expect(usesSearchWords('2kg cow')).toBe(true);
			expect(usesSearchWords('steaks')).toBe(true);
			expect(usesSearchWords('kevytmaito')).toBe(false);
		});
	}
);
