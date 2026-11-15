import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import type { Suggestion } from '../web/lookup';
import { allergenFactsOf, warmAllergenFacts } from './facts-warm';

const s = (
	field: Suggestion['field'],
	value: unknown,
	url: string,
	gtinCited: boolean
): Suggestion => ({
	field,
	value,
	gtinCited,
	sources: [{ url, gtinCited, quote: String(value) }]
});

describe('web allergen facts for lines with no record', () => {
	it('reads contains and may-contain with the source, preferring a page that cites the barcode', () => {
		const f = allergenFactsOf([
			s('allergens', ['maito'], 'https://www.s-kaupat.fi/tuote/x', true),
			s('mayContain', ['pähkinä'], 'https://example.org/x', false)
		])!;
		expect(f).toMatchObject({
			contains: ['maito'],
			mayContain: ['pähkinä'],
			source: { host: 's-kaupat.fi', eanVerified: true },
			evidence: true
		});
	});

	it('says nothing when the web states no allergens', () => {
		expect(allergenFactsOf([s('origin', 'Suomi', 'https://x.fi', false)])).toBeNull();
		expect(allergenFactsOf([s('allergens', [], 'https://x.fi', false)])).toBeNull();
	});

	it('makes no call outside live web mode, and only looks at products without a record', async () => {
		const p = (id: string, declared: boolean) =>
			({
				productId: id,
				allergens: { declared, contains: [], mayContain: [] }
			}) as unknown as Product;
		const catalog = { get: async () => new Map() } as unknown as Catalog;
		// Vitest runs the web lane in fixture mode: nothing is asked.
		expect(await warmAllergenFacts({}, 'ws-t', catalog, [p('1', false), p('2', true)])).toBe(0);
	});
});
