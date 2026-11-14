/**
 * Catalog adapter over Valio's static files + the cache-through mock API (docs/foundations/valio-data.md §4–5).
 * - Static catalogue: normalised once into data/valio/normalized/products.json (gitignored), then loaded from there.
 * - Offers: per-product view of data/valio/cache/{price,availability}/*.json (the same layout the Python probe
 *   writes). With `live`, misses are fetched (≤4 concurrent, ≤200 ids per call, backoff) and written back.
 * - The simulator overlay is applied last, so every offer says whether it is cache, live or simulated.
 */
import { createHash } from 'node:crypto';
import { onScenario } from '$lib/core/scenario';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from '$lib/core/ports';
import type { Offer, Product, ProductId } from '$lib/core/contracts';
import { normalizeProduct, toOffer } from './normalize';
import type { SimOverlay } from '../simulator/overlay';
import {
	assemble,
	RetrievalIndex,
	retrievalModeFromEnv,
	toRetrievalProduct,
	type RetrievalMode
} from './retrieval';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Valio JSON */
type Raw = any;

export interface ValioCatalogOptions {
	/** Folder holding valio_aimo_junction26_*.{json,csv} and cache/ (default: data/valio). */
	dir?: string;
	customer?: string;
	/** Fetch cache misses from the mock API. Without it the adapter is the fixture: cache only. */
	live?: { apiKey: string; baseUrl?: string; fetch?: typeof fetch };
	overlay?: SimOverlay;
	/** Substitute candidate retrieval (default: CATALOG_RETRIEVAL env, else `id`). */
	retrieval?: RetrievalMode;
}

const BOM = new RegExp('^\uFEFF');
const RAW_PRODUCTS = 'valio_aimo_junction26_product_data.json';

function readCsvMap(path: string): Map<string, number> {
	const out = new Map<string, number>();
	if (!existsSync(path)) return out;
	const lines = readFileSync(path, 'utf-8').replace(BOM, '').split(/\r?\n/).slice(1);
	for (const line of lines) {
		const [id, v] = line.split(',');
		if (id && v !== undefined && v !== '') out.set(id.trim(), Number(v));
	}
	return out;
}

/** Loads the normalised catalogue, building it from the raw files when missing or older than them. */
export function loadCatalogue(dir: string): Map<ProductId, Product> {
	const normalized = join(dir, 'normalized', 'products.json');
	const raw = join(dir, RAW_PRODUCTS);
	const fresh =
		existsSync(normalized) &&
		(!existsSync(raw) || statSync(normalized).mtimeMs >= statSync(raw).mtimeMs);
	let products: Product[];
	if (fresh) products = JSON.parse(readFileSync(normalized, 'utf-8'));
	else {
		if (!existsSync(raw))
			throw new Error(`Valio catalogue not found in ${dir} (copy data/valio/ into this checkout)`);
		const co2 = readCsvMap(join(dir, 'valio_aimo_junction26_carbon_footprint.csv'));
		const reliability = readCsvMap(join(dir, 'valio_aimo_junction26_delivery_reliability.csv'));
		products = (JSON.parse(readFileSync(raw, 'utf-8')) as Raw[]).map((r) =>
			normalizeProduct(r, { co2, reliability })
		);
		mkdirSync(join(dir, 'normalized'), { recursive: true });
		writeFileSync(normalized, JSON.stringify(products));
	}
	return new Map(products.map((p) => [p.productId, p]));
}

interface CachedEntry {
	entry: Raw;
	fetchedAt: string;
	source: 'valio_cache' | 'valio_live';
}

/** Per-product index over the cache files: the newest entry per (endpoint, product). Date and customer are ignored by the mock (valio-data.md §3). */
class OfferCache {
	readonly price = new Map<string, CachedEntry>();
	readonly availability = new Map<string, CachedEntry>();
	constructor(private dir: string) {
		for (const ep of ['price', 'availability'] as const) {
			const folder = join(dir, ep);
			if (!existsSync(folder)) continue;
			for (const f of readdirSync(folder)) {
				if (!f.endsWith('.json')) continue;
				const rec = JSON.parse(readFileSync(join(folder, f), 'utf-8'));
				if (rec.status < 200 || rec.status >= 300) continue;
				this.add(ep, rec.body?.products ?? [], rec.fetched_at, 'valio_cache');
			}
		}
	}
	add(
		ep: 'price' | 'availability',
		entries: Raw[],
		fetchedAt: string,
		source: CachedEntry['source']
	) {
		const map = this[ep];
		for (const e of entries) {
			const prev = map.get(String(e.productId));
			if (!prev || prev.fetchedAt <= fetchedAt)
				map.set(String(e.productId), { entry: e, fetchedAt, source });
		}
	}
	/** Writes a response file in the Python helper's layout so both tools share one cache. */
	write(
		ep: 'price' | 'availability',
		customer: string,
		date: string,
		ids: string[],
		status: number,
		body: Raw,
		ms: number
	) {
		const key = `${ep}|${customer}|${date}|${[...ids].sort().join(',')}`;
		const hash = createHash('sha256').update(key).digest('hex').slice(0, 20);
		mkdirSync(join(this.dir, ep), { recursive: true });
		const fetched_at = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
		writeFileSync(
			join(this.dir, ep, `${hash}.json`),
			JSON.stringify({
				key_hash: hash,
				endpoint: ep,
				customer,
				requestedDate: date,
				products: ids,
				status,
				latency_ms: ms,
				fetched_at,
				headers: {},
				tag: 'app',
				body
			})
		);
		return fetched_at;
	}
}

const chunk = <T>(xs: T[], n: number) =>
	Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		})
	);
	return out;
}

export function createValioCatalog(
	opts: ValioCatalogOptions = {}
): Catalog & { products: Map<ProductId, Product> } {
	const dir = opts.dir ?? join('data', 'valio');
	const customer = opts.customer ?? '123';
	const products = loadCatalogue(dir);
	const retrieval = opts.retrieval ?? retrievalModeFromEnv();
	let index: RetrievalIndex | undefined;
	const cache = new OfferCache(join(dir, 'cache'));
	let failures = 0;

	async function fetchMisses(ep: 'price' | 'availability', ids: string[], date: string) {
		const live = opts.live;
		if (!live || ids.length === 0 || failures >= 3) return; // breaker: stay on cache after 3 failures
		const f = live.fetch ?? fetch;
		const base = live.baseUrl ?? 'https://junction26.valioaimo.fi';
		await pool(chunk(ids, 200), 4, async (part) => {
			for (let attempt = 0; attempt < 3; attempt++) {
				const t0 = Date.now();
				try {
					const res = await f(`${base}/api/${ep}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json', 'X-API-Key': live.apiKey },
						body: JSON.stringify({ customer, requestedDate: date, products: part })
					});
					if (res.status === 429 || res.status === 403 || res.status >= 500)
						throw new Error(`HTTP ${res.status}`);
					const body = await res.json();
					const at = cache.write(ep, customer, date, part, res.status, body, Date.now() - t0);
					if (res.ok) cache.add(ep, body.products ?? [], at, 'valio_live');
					failures = 0;
					return;
				} catch {
					failures++;
					await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt * (0.5 + Math.random())));
				}
			}
		});
	}

	return {
		products,
		async get(ids) {
			const out = new Map<ProductId, Product>();
			for (const id of ids) {
				const p = products.get(id);
				if (p) out.set(id, p);
			}
			return out;
		},
		async search(query, o = {}) {
			const words = query.toLowerCase().split(/\s+/).filter(Boolean);
			const foodOnly = o.foodOnly ?? true;
			const hits: Product[] = [];
			for (const p of products.values()) {
				if (foodOnly && !p.isFood) continue;
				if (p.dataQualityFlags.includes('old_flagged_name')) continue;
				const hay = `${p.nameFi} ${p.nameEn ?? ''} ${p.brand ?? ''}`.toLowerCase();
				if (words.every((w) => hay.includes(w))) hits.push(p);
				if (hits.length >= (o.limit ?? 10)) break;
			}
			return hits;
		},
		async offers(ids, deliverBy) {
			const known = ids.filter((id) => products.has(id));
			const notFound = ids.filter((id) => !products.has(id));
			await fetchMisses(
				'price',
				known.filter((id) => !cache.price.has(id)),
				deliverBy
			);
			await fetchMisses(
				'availability',
				known.filter((id) => !cache.availability.has(id)),
				deliverBy
			);
			const offers: Offer[] = known.map((id) => {
				const p = cache.price.get(id);
				const a = cache.availability.get(id);
				const newest = [p, a]
					.filter(Boolean)
					.sort((x, y) => (x!.fetchedAt < y!.fetchedAt ? 1 : -1))[0];
				const offer = toOffer(id, p?.entry, a?.entry, {
					source: newest?.source ?? 'valio_cache',
					at: newest?.fetchedAt,
					ref: `customer ${customer}`
				});
				const dated = deliverBy
					? { ...offer, availability: onScenario(offer.availability, deliverBy) }
					: offer;
				return opts.overlay ? opts.overlay.apply(dated) : dated;
			});
			return { offers, notFound };
		},
		async candidates(productId, limit = 12) {
			const p = products.get(productId);
			if (!p) return [];
			if (retrieval === 'hybrid') {
				index ??= new RetrievalIndex([...products.values()].map(toRetrievalProduct));
				const ix = index;
				return assemble(
					{ ...toRetrievalProduct(p), valioSubstitutes: p.valioSubstitutes },
					(id) => products.has(id),
					(exclude, room) => ix.similar(toRetrievalProduct(p), exclude, room),
					limit
				);
			}
			const rules = p.valioSubstitutes
				.filter((id) => products.has(id))
				.map((id) => ({ productId: id, fromValioRule: true }));
			const seen = new Set([productId, ...rules.map((r) => r.productId)]);
			const unit = p.netPerSalesUnit?.value.unit;
			const domain: { productId: ProductId; fromValioRule: boolean }[] = [];
			for (const q of products.values()) {
				if (
					seen.has(q.productId) ||
					q.category !== p.category ||
					q.temperatureClass !== p.temperatureClass
				)
					continue;
				if (q.dataQualityFlags.includes('old_flagged_name')) continue;
				if (unit && q.netPerSalesUnit && q.netPerSalesUnit.value.unit !== unit) continue;
				domain.push({ productId: q.productId, fromValioRule: false });
			}
			domain.sort((a, b) => (a.productId < b.productId ? -1 : 1));
			return [...rules, ...domain].slice(0, Math.max(limit, rules.length));
		}
	};
}
