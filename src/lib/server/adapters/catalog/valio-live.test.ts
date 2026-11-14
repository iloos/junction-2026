/** Valio cache-through: batching, the half-open breaker, traces, and the PG catalogue storing what Valio answers. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExternalCallTrace } from '$lib/core/contracts';
import { createFixtureDb } from '../../db/pglite';
import { offerCache, products } from '../../db/schema';
import type { AnyDb } from '../../store/drizzle-store';
import { createPgCatalog } from './pg';
import { createValioCatalog } from './valio';
import { createValioLive } from './valio-live';

/** A fake Valio: answers each requested id, or fails while `down`. Records every request. */
function fakeValio() {
	const calls: { ep: string; ids: string[] }[] = [];
	const f = {
		down: false,
		calls,
		fetch: (async (url: string, init: RequestInit) => {
			const ids = JSON.parse(String(init.body)).products as string[];
			const ep = url.endsWith('/price') ? 'price' : 'availability';
			calls.push({ ep, ids });
			if (f.down) return new Response('busy', { status: 503 });
			const products = ids.map((productId) =>
				ep === 'price'
					? {
							productId,
							quantity: 1,
							catalogPrice: { value: 12.5, valueWithTax: 14.19, currency: 'EUR' },
							error: false
						}
					: {
							productId,
							closingTime: '2026-12-09T15:00:00+0200',
							salesBlock: false,
							logisticModel: 'Stock',
							scheduleLines: [
								{
									salesBlock: false,
									availableAmount: 40,
									availableDate: '2026-12-10',
									salesUnit: 'KG'
								}
							]
						}
			);
			return Response.json({ products });
		}) as unknown as typeof fetch
	};
	return f;
}

describe('createValioLive', () => {
	it('splits into ≤200-id calls and traces each one', async () => {
		const v = fakeValio();
		const traces: ExternalCallTrace[] = [];
		const live = createValioLive({ apiKey: 'k', fetch: v.fetch, onCall: (t) => traces.push(t) });
		const ids = Array.from({ length: 450 }, (_, i) => String(400000 + i));
		const got = await live.fetch('price', ids, '2026-12-10');
		expect(got).toHaveLength(450);
		expect(v.calls.map((c) => c.ids.length).sort()).toEqual([200, 200, 50]);
		expect(traces).toHaveLength(3);
		expect(traces[0]).toMatchObject({
			api: 'valio',
			purpose: 'offers.price',
			cache: 'live',
			ok: true
		});
	});

	it('opens after 3 failures, half-opens after the cool-down, and closes on a good trial', async () => {
		const v = fakeValio();
		let t = 0;
		const live = createValioLive({
			apiKey: 'k',
			fetch: v.fetch,
			now: () => t,
			coolDownMs: 60_000,
			retries: 2,
			backoffMs: 0
		});
		v.down = true;
		expect(await live.fetch('availability', ['1'], 'd')).toEqual([]);
		expect(live.breaker()).toBe('open');
		const n = v.calls.length;
		expect(await live.fetch('availability', ['1'], 'd')).toEqual([]);
		expect(v.calls.length).toBe(n); // open: nothing goes out
		t = 61_000;
		expect(live.breaker()).toBe('half_open');
		v.down = false;
		expect(await live.fetch('availability', ['1'], 'd')).toHaveLength(1);
		expect(live.breaker()).toBe('closed');
	});

	it('a failed trial reopens the breaker for another cool-down', async () => {
		const v = fakeValio();
		let t = 0;
		const live = createValioLive({ apiKey: 'k', fetch: v.fetch, now: () => t, backoffMs: 0 });
		v.down = true;
		await live.fetch('price', ['1'], 'd');
		t = 61_000;
		await live.fetch('price', ['1'], 'd');
		expect(live.breaker()).toBe('open');
	});
});

const DIR = join('data', 'valio');
describe.skipIf(!existsSync(join(DIR, 'normalized', 'products.json')))(
	'PG catalogue cache-through',
	() => {
		const file = createValioCatalog({ dir: DIR, retrieval: 'id' });
		const ID = '462150';

		async function setup(availabilityAt: string) {
			const db = (await createFixtureDb()).db as unknown as AnyDb;
			const p = file.products.get(ID)!;
			await db.insert(products).values({
				productId: p.productId,
				nameFi: p.nameFi,
				nameEn: p.nameEn ?? null,
				category: p.category,
				isFood: p.isFood,
				doc: p
			});
			await db.insert(offerCache).values({
				endpoint: 'availability',
				customer: '123',
				requestedDate: '2026-11-13',
				productId: ID,
				body: { productId: ID, quantity: 5 },
				fetchedAt: availabilityAt
			});
			return db;
		}

		it('fetches a missing price and stale availability, stores them and labels the offer live', async () => {
			const db = await setup('2026-11-14T08:00:00Z');
			const v = fakeValio();
			const now = () => new Date('2026-11-14T09:00:00Z').getTime();
			const live = createValioLive({ apiKey: 'k', fetch: v.fetch, now });
			const pg = createPgCatalog(db, { retrieval: 'id', live, now });
			const { offers } = await pg.offers([ID], '2026-12-10');
			expect(v.calls.map((c) => c.ep).sort()).toEqual(['availability', 'price']);
			expect(offers[0].price?.provenance.source).toBe('valio_live');
			const rows = await db.select().from(offerCache);
			expect(rows.filter((r) => r.productId === ID).length).toBeGreaterThanOrEqual(3);

			// A second call within the TTL reads what was stored: no call goes out, labelled as cache.
			const again = await pg.offers([ID], '2026-12-10');
			expect(v.calls).toHaveLength(2);
			expect(again.offers[0].price?.provenance.source).toBe('valio_cache');
		});

		it('keeps fresh availability and serves the cache when Valio is down', async () => {
			const db = await setup('2026-11-14T08:55:00Z');
			const v = fakeValio();
			v.down = true;
			const live = createValioLive({ apiKey: 'k', fetch: v.fetch, backoffMs: 0 });
			const now = () => new Date('2026-11-14T09:00:00Z').getTime();
			const pg = createPgCatalog(db, { retrieval: 'id', live, now });
			const { offers } = await pg.offers([ID], '2026-12-10');
			expect(v.calls.every((c) => c.ep === 'price')).toBe(true);
			expect(offers).toHaveLength(1);
			expect(offers[0].availability.provenance?.source ?? 'valio_cache').toBe('valio_cache');
		});
	}
);

describe('one concurrency bound per adapter (R9-07)', () => {
	const counting = () => {
		const c = { active: 0, max: 0, calls: 0 };
		const fetch = async () => {
			c.calls++;
			c.active++;
			c.max = Math.max(c.max, c.active);
			await new Promise((r) => setTimeout(r, 10));
			c.active--;
			return new Response(JSON.stringify({ products: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		};
		return { c, fetch: fetch as typeof globalThis.fetch };
	};

	it('twelve callers on both endpoints never have more than four calls in flight', async () => {
		const { c, fetch } = counting();
		const live = createValioLive({ apiKey: 'fake', retries: 0, fetch });
		await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				live.fetch(i % 2 ? 'availability' : 'price', [String(100000 + i)], '2026-12-10')
			)
		);
		expect(c.calls).toBe(12);
		expect(c.max).toBe(4);
	});

	it('identical misses in flight share one call', async () => {
		const { c, fetch } = counting();
		const live = createValioLive({ apiKey: 'fake', retries: 0, fetch });
		await Promise.all(
			Array.from({ length: 12 }, () => live.fetch('availability', ['100001'], '2026-12-10'))
		);
		expect(c.calls).toBe(1);
	});
});
