import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import { createWebHttp } from './http';
import { createListingFinder, type ProductListing } from './listing';

/**
 * Prewarms the demo products' verified public pages, so the demo makes no live call for them (opt-in, live Exa +
 * public pages, a few cents):
 *   PREWARM_LISTINGS=1 DATABASE_URL= node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/web/listing-prewarm.test.ts
 * The set: every product in the kitchen event seeds (fixtures/seeds/*.json), plus milk, butter, rice and salmon.
 * Writes src/lib/server/web/fixtures/listings.json ({productId: ProductListing | null}); image files are never copied.
 */
const EXTRA = ['464201', '464411', '466964', '462150'];

describe.skipIf(process.env.PREWARM_LISTINGS !== '1')('prewarm public product pages', () => {
	it('resolves the demo set', { timeout: 1_800_000 }, async () => {
		const ids = new Set(EXTRA);
		for (const f of readdirSync('fixtures/seeds').filter((x) => x.endsWith('.json')))
			for (const m of readFileSync(join('fixtures/seeds', f), 'utf8').matchAll(
				/"productId":\s*"(\d{6})"/g
			))
				ids.add(m[1]);
		const all = JSON.parse(
			readFileSync('data/valio/normalized/products.json', 'utf8')
		) as Product[];
		const byId = new Map(all.map((p) => [p.productId, p]));
		const find = createListingFinder({
			exa: createWebHttp({ api: 'exa', apiKey: process.env.EXA_API_KEY! })
		});
		const listings: Record<string, ProductListing | null> = {};
		let found = 0;
		for (const id of [...ids].sort()) {
			const p = byId.get(id);
			if (!p) continue;
			listings[id] = await find(p).catch(() => null);
			if (listings[id]) found++;
		}
		writeFileSync(
			'src/lib/server/web/fixtures/listings.json',
			JSON.stringify(
				{
					$comment:
						'Verified public pages for the demo products (barcode equals our GTIN), prewarmed by listing-prewarm.test.ts. null = no public page carries the barcode. Images are hotlinked, never copied.',
					recordedAt: new Date().toISOString().slice(0, 10),
					listings
				},
				null,
				'\t'
			) + '\n'
		);
		console.log(
			`prewarmed ${Object.keys(listings).length} products, ${found} with a verified page`
		);
		expect(Object.keys(listings).length).toBeGreaterThan(10);
	});
});
