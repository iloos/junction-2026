/**
 * A product's public page, verified by GTIN: first Valio Aimo's browse-only catalogue (www.valioaimo.fi/toimitustukku/
 * <slug>/, found by an Exa search for the GTIN on valioaimo.fi, or at the slug of the product's name when the search
 * has nothing), then Open Food Facts by barcode (open licence). A page counts only when its own EAN equals the
 * product's GTIN; nothing else, and no image, otherwise. The photo is the page's own (their CDN, hotlinked, never
 * copied). Kept as a web finding next to the catalogue, never written into it (D6): a found page for a week, none
 * for minutes. Every request goes through the shared outside-call helper: traced and charged to the caller's web cap.
 */
import type { Product } from '$lib/core/contracts';
import { createExternalCall, type CacheStore } from '../external/call';
import type { Findings } from './findings';
import type { SpendGuard } from './spend';
import type { WebCall } from './http';

export const LISTING_HOST = 'https://www.valioaimo.fi';
const WEEK_MS = 7 * 24 * 3_600_000;
const NONE_MS = 5 * 60_000;

export interface ProductListing {
	pageUrl: string;
	/** Valio Aimo's webshop page for the same product (ordering needs an account there). */
	shopUrl?: string;
	/** The page's own product photo, hotlinked. */
	imageUrl?: string;
	source: 'valioaimo' | 'openfoodfacts';
	verifiedBy: 'gtin';
	/** When the page was read and its EAN checked. */
	checkedAt: string;
}

export interface ListingPage {
	url: string;
	title: string;
	ean?: string;
	imageUrl?: string;
	shopUrl?: string;
}

/** The slug Valio Aimo's site gives a product name: "HK Palvikinkku viipaloitu 1,5 kg" → "hk-palvikinkku-viipaloitu-15-kg". */
export function listingSlug(name: string): string {
	return (
		name
			.toLowerCase()
			// å, ä, ö, é … lose their marks (the site writes "cafe", "lohi-perunalaatikko").
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[,.®™%]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	);
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'");

/** Title, EAN, photo and webshop link from a Valio Aimo product page's HTML. */
export function parseListingPage(url: string, html: string): ListingPage | null {
	const title = html
		.match(/<title>([^<]*)<\/title>/i)?.[1]
		?.replace(/\s*-\s*Valio Aimo\s*$/i, '')
		.trim();
	if (!title) return null;
	const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
	const ean = text.match(/EAN-koodi\s*(\d{8,14})/)?.[1];
	const image = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
	const shop = html.match(/https:\/\/toimitustukku\.valioaimo\.fi\/[^"'\s<>]*\/p\/\d+/)?.[0];
	return {
		url,
		title: decode(title),
		...(ean ? { ean } : {}),
		...(image && /^https:\/\//.test(image) ? { imageUrl: decode(image) } : {}),
		...(shop ? { shopUrl: decode(shop) } : {})
	};
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');
/** The page names this exact product: its EAN equals the GTIN (leading zeros aside). */
export const sameGtin = (a?: string, b?: string) => !!digits(a) && digits(a) === digits(b);

export interface ListingDeps {
	/** Exa search (live); absent = the slug page and Open Food Facts only. */
	exa?: WebCall;
	/** GET a public page as text; null for a 404. */
	getPage?: (url: string) => Promise<string | null>;
	/** GET JSON (Open Food Facts); null for a 404. */
	getJson?: (url: string) => Promise<unknown>;
	/** Where verified pages are kept (web findings, Postgres when attached). */
	findings?: Findings;
	store?: CacheStore;
	guard?: SpendGuard;
	now?: () => Date;
}

const UA = { 'user-agent': 'Mandate-demo/1.0 (public product page check)' };
async function pageGet(url: string): Promise<string | null> {
	const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
	return res.text();
}
async function jsonGet(url: string): Promise<unknown> {
	const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
	return res.json();
}

type Target = Pick<Product, 'productId' | 'nameFi' | 'gtin'>;

export function createListingFinder(d: ListingDeps = {}) {
	const now = d.now ?? (() => new Date());
	const pages = createExternalCall({
		api: 'other',
		name: 'valioaimo-public',
		store: d.store,
		guard: d.guard
	});
	const off = createExternalCall({
		api: 'other',
		name: 'openfoodfacts',
		store: d.store,
		guard: d.guard
	});
	const getPage = d.getPage ?? pageGet;
	const getJson = d.getJson ?? jsonGet;

	async function read(url: string): Promise<ListingPage | null> {
		const r = await pages<string | null>(
			{ key: url, purpose: 'product page', maxAgeMs: WEEK_MS, shortLived: (h) => h === null },
			async () => ({ value: await getPage(url) })
		);
		return r.value ? parseListingPage(url, r.value) : null;
	}

	async function candidates(p: Target): Promise<string[]> {
		const out: string[] = [];
		if (d.exa) {
			const r = await d.exa<{ results?: { url?: string }[] }>(
				'/search',
				{
					query: `"${p.gtin}" site:valioaimo.fi`,
					type: 'auto',
					numResults: 3,
					includeDomains: ['valioaimo.fi']
				},
				{ purpose: 'product page by GTIN' }
			);
			for (const x of r.body.results ?? [])
				if (x.url && /^https:\/\/www\.valioaimo\.fi\/toimitustukku\/[^/]+/.test(x.url))
					out.push(x.url.replace(/\.md$/, '/'));
		}
		out.push(`${LISTING_HOST}/toimitustukku/${listingSlug(p.nameFi)}/`);
		return [...new Set(out)].slice(0, 4);
	}

	async function valioAimo(p: Target): Promise<ProductListing | null> {
		for (const url of await candidates(p)) {
			const page = await read(url).catch(() => null);
			if (page && sameGtin(page.ean, p.gtin))
				return {
					pageUrl: page.url,
					...(page.shopUrl ? { shopUrl: page.shopUrl } : {}),
					...(page.imageUrl ? { imageUrl: page.imageUrl } : {}),
					source: 'valioaimo',
					verifiedBy: 'gtin',
					checkedAt: now().toISOString()
				};
		}
		return null;
	}

	async function openFoodFacts(p: Target): Promise<ProductListing | null> {
		const gtin = digits(p.gtin);
		const r = await off<unknown>(
			{
				key: gtin,
				purpose: 'open food facts',
				maxAgeMs: WEEK_MS,
				shortLived: (v) => (v as { status?: number } | null)?.status !== 1
			},
			async () => ({
				value: await getJson(
					`https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=code,product_name,image_front_url`
				)
			})
		);
		const b = r.value as {
			status?: number;
			product?: { code?: string; image_front_url?: string };
		} | null;
		if (b?.status !== 1 || !sameGtin(b.product?.code, p.gtin)) return null;
		const img = b.product?.image_front_url;
		return {
			pageUrl: `https://world.openfoodfacts.org/product/${gtin}`,
			...(img && /^https:\/\//.test(img) ? { imageUrl: img } : {}),
			source: 'openfoodfacts',
			verifiedBy: 'gtin',
			checkedAt: now().toISOString()
		};
	}

	/** The product's verified public page, or null. Kept as a finding (`listing:<productId>`). */
	return async function find(p: Target): Promise<ProductListing | null> {
		if (!digits(p.gtin)) return null;
		const id = `listing:${p.productId}`;
		const kept = d.findings?.get(id);
		const data = kept?.data as { gtin?: string; listing?: ProductListing | null } | undefined;
		if (kept && data && data.gtin === p.gtin) {
			const age = now().getTime() - Date.parse(kept.at);
			if (age < (data.listing ? WEEK_MS : NONE_MS)) return data.listing ?? null;
		}
		const listing =
			(await valioAimo(p).catch(() => null)) ?? (await openFoodFacts(p).catch(() => null));
		d.findings?.put({
			id,
			kind: 'listing',
			at: now().toISOString(),
			title: `Public page for ${p.nameFi}`,
			sources: listing ? [listing.pageUrl] : [],
			data: { gtin: p.gtin, listing }
		});
		return listing;
	};
}
