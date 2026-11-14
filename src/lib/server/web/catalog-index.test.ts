/**
 * F31: the Postgres `catalogIndex` (raw SQL on `products.doc`), which recall matching uses on prod.
 * Always on PGlite with seeded rows; opt-in against the real catalogue (`MANDATE_TEST_PG=1` and
 * DATABASE_URL), read-only there.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { createFixtureDb } from '../db/pglite';
import { products } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';
import { catalogIndex } from './index';
import { matchNotice } from './recall';
import { EGG_RECALL_URL, recordedNotice } from './fixture';

const doc = (p: Partial<Product> & { productId: string; nameFi: string; vendor: string }) =>
	({ category: '10101', isFood: true, ...p }) as Product;
const rows = [
	doc({
		productId: 'p1',
		gtin: '6430017908381',
		nameFi: 'Laitilan Kanatarha kuorittu kananmuna 1,5kg',
		vendor: 'MUNAX OY',
		brand: 'Laitilan Kanatarha'
	}),
	doc({
		productId: 'p2',
		gtin: '6430017909647',
		nameFi: 'Munax Kokomuna vapaa 1000 g',
		vendor: 'MUNAX OY',
		brand: 'Munax'
	}),
	doc({
		productId: 'p3',
		gtin: '6400000000001',
		nameFi: 'Sokeri 1 kg',
		vendor: 'SUOMEN SOKERI OY'
	}),
	doc({ productId: 'p4', nameFi: '100% mehu', vendor: 'MEHU_100% OY', brand: 'Mehu_100%' })
];
/** No `products` map: catalogIndex takes the SQL path. */
const sqlCatalog = {} as Catalog;

describe('catalogIndex on Postgres (PGlite)', { timeout: 30_000 }, () => {
	let index: ReturnType<typeof catalogIndex>;
	beforeAll(async () => {
		const { db } = await createFixtureDb();
		await db.insert(products).values(
			rows.map((p) => ({
				productId: p.productId,
				nameFi: p.nameFi,
				category: p.category,
				isFood: true,
				doc: p
			}))
		);
		index = catalogIndex(sqlCatalog, db as unknown as AnyDb);
	});

	it('byGtin returns exactly the products whose doc carries one of the GTINs', async () => {
		const hit = await index.byGtin(['6430017908381', '6400000000001', '0000000000000']);
		expect(hit.map((p) => p.productId).sort()).toEqual(['p1', 'p3']);
		expect(await index.byGtin([])).toEqual([]);
	});

	it('byBrandOrVendor matches brand or vendor as whole words, case-insensitive', async () => {
		expect((await index.byBrandOrVendor('munax')).map((p) => p.productId).sort()).toEqual([
			'p1',
			'p2'
		]);
		expect(await index.byBrandOrVendor('sok')).toEqual([]); // "sok" is not "sokeri"
		expect((await index.byBrandOrVendor('munax', 1)).length).toBe(1);
	});

	it('LIKE wildcards in the term are escaped and match only themselves', async () => {
		expect((await index.byBrandOrVendor('mehu_100%')).map((p) => p.productId)).toEqual(['p4']);
		expect(await index.byBrandOrVendor('_')).toEqual([]);
	});

	it('the real egg recall matches through SQL the same way as in memory: supplier leads only', async () => {
		const ms = await matchNotice(recordedNotice(EGG_RECALL_URL)!, index);
		expect(ms.map((m) => [m.productId, m.tier]).sort()).toEqual([
			['p1', 'supplier'],
			['p2', 'supplier']
		]);
	});
});

const ON = process.env.MANDATE_TEST_PG === '1';

describe.skipIf(!ON)('catalogIndex on the real catalogue (opt-in, read-only)', () => {
	let index: ReturnType<typeof catalogIndex>;
	beforeAll(async () => {
		const { createPgDb } = await import('../db/client');
		const db = await createPgDb({ runMigrations: false });
		index = catalogIndex(sqlCatalog, db as unknown as AnyDb);
	}, 60_000);

	it('finds a known product by GTIN (array-shaped rows from postgres-js)', async () => {
		const [p] = await index.byGtin(['6430017908381']);
		expect(p?.productId).toBe('464700');
	});

	it('Munax Oy is the vendor of catalogue products, matched as a whole word', async () => {
		const ms = await index.byBrandOrVendor('munax');
		expect(ms.length).toBeGreaterThan(0);
		expect(ms.every((p) => /munax/i.test(`${p.brand ?? ''} ${p.vendor}`))).toBe(true);
	});
});
