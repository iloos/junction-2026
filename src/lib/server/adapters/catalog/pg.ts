/**
 * Catalog adapter over Postgres: the `products` and `offer_cache` tables that scripts/seed-db.ts fills from
 * data/valio/. Production builds have no data/valio/ (third-party data, gitignored), so this is how they read the
 * catalogue. Behaviour mirrors the file-backed adapter in valio.ts: unknown ids are notFound and never get offers,
 * search hides non-food and `old_flagged_name` products, candidates are Valio's rules then the same
 * category/temperature/unit, and the simulator overlay is applied last.
 */
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { SCENARIO, onScenario } from '$lib/core/scenario';
import type { Catalog } from '$lib/core/ports';
import type { Offer, Product, ProductId } from '$lib/core/contracts';
import { products, offerCache } from '../../db/schema';
import type { AnyDb } from '../../store/drizzle-store';
import type { SimOverlay } from '../simulator/overlay';
import { toOffer } from './normalize';
import {
	assemble,
	RetrievalIndex,
	retrievalModeFromEnv,
	toRetrievalProduct,
	type RetrievalMode
} from './retrieval';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Valio JSON stored as jsonb */
type Raw = any;

export interface PgCatalogOptions {
	customer?: string;
	overlay?: SimOverlay;
	/** Substitute candidate retrieval (default: CATALOG_RETRIEVAL env, else `id`). */
	retrieval?: RetrievalMode;
}

export type OfferCacheRow = typeof offerCache.$inferInsert;

/**
 * One cache file (data/valio/cache/{price,availability}/*.json) → one offer_cache row per product entry.
 * Non-2xx responses carry no entries. Same mapping as scripts/seed-db.ts, which cannot import this module.
 */
export function rowsFromCacheFile(endpoint: 'price' | 'availability', rec: Raw): OfferCacheRow[] {
	if (!rec || rec.status < 200 || rec.status >= 300) return [];
	return ((rec.body?.products ?? []) as Raw[])
		.filter((e) => e?.productId !== undefined && e?.productId !== null)
		.map((e) => ({
			endpoint,
			customer: String(rec.customer),
			requestedDate: String(rec.requestedDate),
			productId: String(e.productId),
			body: e,
			fetchedAt: String(rec.fetched_at)
		}));
}

/** Postgres returns timestamptz as text in its own format; the contract wants ISO 8601 with an offset. */
const iso = (t: string) => new Date(t).toISOString();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createPgCatalog(db: AnyDb, opts: PgCatalogOptions = {}): Catalog {
	const customer = opts.customer ?? '123';
	const retrieval = opts.retrieval ?? retrievalModeFromEnv();
	// The hybrid index needs every food product's name fields once (~17.5k small rows), then lives in memory.
	let index: Promise<RetrievalIndex> | undefined;
	const loadIndex = () =>
		(index ??= (async () => {
			const rows = await db
				.select({ doc: products.doc })
				.from(products)
				.where(eq(products.isFood, true));
			const ps = rows.map((r) => toRetrievalProduct(r.doc as Product));
			return new RetrievalIndex(ps);
		})().catch((e) => {
			index = undefined;
			throw e;
		}));

	async function docs(ids: ProductId[]): Promise<Map<ProductId, Product>> {
		const out = new Map<ProductId, Product>();
		if (ids.length === 0) return out;
		const rows = await db
			.select({ id: products.productId, doc: products.doc })
			.from(products)
			.where(inArray(products.productId, [...new Set(ids)]));
		for (const r of rows) out.set(r.id, r.doc as Product);
		return out;
	}

	return {
		async get(ids) {
			const found = await docs(ids);
			// Input order, like the file adapter.
			const out = new Map<ProductId, Product>();
			for (const id of ids) {
				const p = found.get(id);
				if (p) out.set(id, p);
			}
			return out;
		},

		async search(query, o = {}) {
			const words = query.toLowerCase().split(/\s+/).filter(Boolean);
			const hay = sql`(${products.nameFi} || ' ' || coalesce(${products.nameEn}, '') || ' ' || coalesce(${products.doc}->>'brand', ''))`;
			const conds = [
				...words.map((w) => ilike(hay, `%${escapeLike(w)}%`)),
				sql`not coalesce(${products.doc}->'dataQualityFlags', '[]'::jsonb) ? 'old_flagged_name'`
			];
			if (o.foodOnly ?? true) conds.push(eq(products.isFood, true));
			const rows = await db
				.select({ doc: products.doc })
				.from(products)
				.where(and(...conds))
				.orderBy(asc(products.productId))
				.limit(o.limit ?? 10);
			return rows.map((r) => r.doc as Product);
		},

		// The cache is not keyed by date (the mock API ignores requestedDate); deliverBy re-dates it (onScenario).
		async offers(ids, deliverBy) {
			const knownSet = new Set(
				ids.length === 0
					? []
					: (
							await db
								.select({ id: products.productId })
								.from(products)
								.where(inArray(products.productId, [...new Set(ids)]))
						).map((r) => r.id)
			);
			const known = ids.filter((id) => knownSet.has(id));
			const notFound = ids.filter((id) => !knownSet.has(id));
			// Newest row per (endpoint, product). The mock API ignores requestedDate, so the date is not a key here.
			const cached =
				known.length === 0
					? []
					: await db
							.selectDistinctOn([offerCache.endpoint, offerCache.productId], {
								endpoint: offerCache.endpoint,
								productId: offerCache.productId,
								body: offerCache.body,
								fetchedAt: offerCache.fetchedAt
							})
							.from(offerCache)
							.where(
								and(
									eq(offerCache.customer, customer),
									inArray(offerCache.productId, [...new Set(known)])
								)
							)
							.orderBy(offerCache.endpoint, offerCache.productId, desc(offerCache.fetchedAt));
			const price = new Map<string, { body: Raw; at: string }>();
			const availability = new Map<string, { body: Raw; at: string }>();
			for (const r of cached)
				(r.endpoint === 'price' ? price : availability).set(r.productId, {
					body: r.body,
					at: iso(r.fetchedAt)
				});
			const offers: Offer[] = known.map((id) => {
				const p = price.get(id);
				const a = availability.get(id);
				const newest = [p, a].filter(Boolean).sort((x, y) => (x!.at < y!.at ? 1 : -1))[0];
				const offer = toOffer(id, p?.body, a?.body, {
					source: 'valio_cache',
					at: newest?.at,
					ref: `customer ${customer}`
				});
				// Always on the scenario's dates: an offers path that skipped this would show November cut-offs.
				const dated = {
					...offer,
					availability: onScenario(offer.availability, deliverBy ?? SCENARIO.delivery)
				};
				return opts.overlay ? opts.overlay.apply(dated) : dated;
			});
			return { offers, notFound };
		},

		async candidates(productId, limit = 12) {
			const p = (await docs([productId])).get(productId);
			if (!p) return [];
			if (retrieval === 'hybrid') {
				const ix = await loadIndex();
				const ruleDocs = await docs(p.valioSubstitutes);
				return assemble(
					{ ...toRetrievalProduct(p), valioSubstitutes: p.valioSubstitutes },
					(id) => ruleDocs.has(id),
					(exclude, room) => ix.similar(toRetrievalProduct(p), exclude, room),
					limit
				);
			}
			const existing = await docs(p.valioSubstitutes);
			const rules = p.valioSubstitutes
				.filter((id) => existing.has(id))
				.map((id) => ({ productId: id, fromValioRule: true }));
			const seen = new Set([productId, ...rules.map((r) => r.productId)]);
			const unit = p.netPerSalesUnit?.value.unit;
			const rows = await db
				.select({ doc: products.doc })
				.from(products)
				.where(eq(products.category, p.category))
				.orderBy(asc(products.productId));
			const domain: { productId: ProductId; fromValioRule: boolean }[] = [];
			for (const { doc } of rows) {
				const q = doc as Product;
				if (seen.has(q.productId) || q.temperatureClass !== p.temperatureClass) continue;
				if (q.dataQualityFlags.includes('old_flagged_name')) continue;
				if (unit && q.netPerSalesUnit && q.netPerSalesUnit.value.unit !== unit) continue;
				domain.push({ productId: q.productId, fromValioRule: false });
			}
			// JS sort, not SQL collation, so the order matches the file adapter exactly.
			domain.sort((a, b) => (a.productId < b.productId ? -1 : 1));
			return [...rules, ...domain].slice(0, Math.max(limit, rules.length));
		}
	};
}
