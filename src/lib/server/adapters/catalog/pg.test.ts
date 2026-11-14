import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Catalog } from '$lib/core/ports';
import { Offer, type Product } from '$lib/core/contracts';
import { createFixtureDb } from '../../db/pglite';
import { offerCache, products } from '../../db/schema';
import type { AnyDb } from '../../store/drizzle-store';
import { createPgCatalog, rowsFromCacheFile, type OfferCacheRow } from './pg';
import { createValioCatalog } from './valio';
import { assemble, RetrievalIndex, toRetrievalProduct } from './retrieval';

const DIR = join('data', 'valio');
const HERO = [
	'462150',
	'462490',
	'462919',
	'462477',
	'464201',
	'464440',
	'463876',
	'463437',
	'462421',
	'464076'
];

/** Same rows seed-db writes: products of the heroes' categories (so candidates compare exactly) + all cache rows. */
async function seed(db: AnyDb, file: Catalog & { products: Map<string, Product> }) {
	const cats = new Set(HERO.map((id) => file.products.get(id)?.category));
	const docs = [...file.products.values()].filter((p) => cats.has(p.category));
	for (let i = 0; i < docs.length; i += 500)
		await db.insert(products).values(
			docs.slice(i, i + 500).map((p) => ({
				productId: p.productId,
				nameFi: p.nameFi,
				nameEn: p.nameEn ?? null,
				category: p.category,
				isFood: p.isFood,
				doc: p
			}))
		);
	const newest = new Map<string, OfferCacheRow>();
	for (const ep of ['price', 'availability'] as const) {
		const folder = join(DIR, 'cache', ep);
		for (const f of readdirSync(folder).filter((f) => f.endsWith('.json')))
			for (const r of rowsFromCacheFile(ep, JSON.parse(readFileSync(join(folder, f), 'utf-8')))) {
				const k = `${r.endpoint}|${r.customer}|${r.requestedDate}|${r.productId}`;
				const prev = newest.get(k);
				if (!prev || prev.fetchedAt < r.fetchedAt) newest.set(k, r);
			}
	}
	const rows = [...newest.values()];
	for (let i = 0; i < rows.length; i += 500)
		await db.insert(offerCache).values(rows.slice(i, i + 500));
	return docs.length;
}

describe.skipIf(!existsSync(join(DIR, 'normalized', 'products.json')))(
	'Postgres catalog matches the file catalog',
	() => {
		const file = createValioCatalog({ dir: DIR, retrieval: 'id' });
		let pg: Catalog;
		let db: AnyDb;

		beforeAll(async () => {
			db = (await createFixtureDb()).db as unknown as AnyDb;
			const n = await seed(db, file);
			expect(n).toBeGreaterThan(HERO.length);
			pg = createPgCatalog(db, { retrieval: 'id' });
		}, 60_000);

		it('get returns the same docs', async () => {
			const ids = [...HERO, '479999'];
			const [a, b] = await Promise.all([file.get(ids), pg.get(ids)]);
			expect([...b.keys()]).toEqual([...a.keys()]);
			expect(Object.fromEntries(b)).toEqual(Object.fromEntries(a));
			expect(b.has('479999')).toBe(false);
		});

		it('offers match on availability and price, unknown ids are notFound', async () => {
			const ids = [...HERO, '479999'];
			const [a, b] = await Promise.all([
				file.offers(ids, '2026-12-14'),
				pg.offers(ids, '2026-12-14')
			]);
			expect(b.notFound).toEqual(['479999']);
			expect(b.notFound).toEqual(a.notFound);
			const pick = (o: Offer) => ({
				productId: o.productId,
				kind: o.availability.kind,
				amount: o.availability.amount,
				unitCents: o.price?.unitCents ?? null
			});
			expect(b.offers.map(pick)).toEqual(a.offers.map(pick));
			for (const o of b.offers) expect(() => Offer.parse(o)).not.toThrow();
			expect(b.offers.some((o) => o.price !== null)).toBe(true);
		});

		it('search finds the salmon fillet', async () => {
			const hits = await pg.search('lohifilee', { limit: 50 });
			expect(hits.map((p) => p.productId)).toContain('462150');
			expect(hits.every((p) => p.isFood && !p.dataQualityFlags.includes('old_flagged_name'))).toBe(
				true
			);
		});

		it('candidates put Valio rules first and match the file catalog', async () => {
			const [a, b] = await Promise.all([file.candidates('463437'), pg.candidates('463437')]);
			expect(b.slice(0, 2)).toEqual([
				{ productId: '462421', fromValioRule: true },
				{ productId: '464076', fromValioRule: true }
			]);
			expect(b).toEqual(a);
			expect(await pg.candidates('479999')).toEqual([]);
		});

		it('hybrid candidates are the shared retrieval over the same rows, in the same order', async () => {
			const hy = createPgCatalog(db, { retrieval: 'hybrid' });
			const cats = new Set(HERO.map((id) => file.products.get(id)?.category));
			const docs = [...file.products.values()].filter((p) => cats.has(p.category));
			const byId = new Map(docs.map((p) => [p.productId, p]));
			const ix = new RetrievalIndex(docs.map(toRetrievalProduct));
			for (const id of ['463437', '462150', '464201']) {
				const p = byId.get(id)!;
				const want = assemble(
					{ ...toRetrievalProduct(p), valioSubstitutes: p.valioSubstitutes },
					(x) => byId.has(x),
					(ex, room) => ix.similar(toRetrievalProduct(p), ex, room),
					12
				);
				const got = await hy.candidates(id, 12);
				expect(got).toEqual(want);
				expect(got.length).toBeGreaterThan(0);
				expect(got.filter((c) => c.fromValioRule)).toEqual(want.filter((c) => c.fromValioRule));
			}
			expect(await hy.candidates('479999')).toEqual([]);
		});
	}
);
