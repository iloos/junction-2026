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
	/** Who published the page: Valio Aimo, Open Food Facts, the brand's own site, or a Finnish retailer. */
	source: 'valioaimo' | 'openfoodfacts' | 'manufacturer' | 'retailer';
	/** The page's host, so the UI and the sponsor claims can name it ("s-kaupat.fi"). */
	host?: string;
	verifiedBy: 'gtin';
	/** Product facts the page states (EAN-verified pages only), kept as evidence, never written into the catalogue. */
	facts?: PageFacts;
	/** When the page was read and its EAN checked. */
	checkedAt: string;
}

/** What an EAN-verified page says about the product, in its own words (D6: evidence next to the catalogue). */
export interface PageFacts {
	ingredients?: string;
	allergens?: string[];
	mayContain?: string[];
	origin?: string;
	netQuantity?: string;
}

/** Finnish grocers whose product pages carry the EAN (searched after the brand's own site). */
export const RETAILERS = ['s-kaupat.fi', 'k-ruoka.fi', 'foodie.fi'] as const;

/** Context.dev JSON extraction of a product page. */
export const PRODUCT_PAGE_SCHEMA = {
	type: 'object',
	properties: {
		ean: { type: 'string', description: 'The EAN/GTIN barcode printed on the page, digits only' },
		productName: { type: 'string' },
		imageUrl: { type: 'string', description: 'Absolute URL of the main product photo' },
		ingredients: { type: 'string', description: 'The ingredient list as written' },
		allergens: { type: 'array', items: { type: 'string' } },
		mayContain: { type: 'array', items: { type: 'string' } },
		origin: { type: 'string', description: 'Country of origin as written' },
		netQuantity: { type: 'string', description: 'Net quantity as written, e.g. 1,5 kg' }
	}
} as const;
const PRODUCT_PAGE_INSTRUCTIONS =
	'Extract the single product this page is about. Copy values as written; leave a field out when the page does not state it. Never guess an EAN.';

interface ExtractedPage extends PageFacts {
	ean?: string;
	productName?: string;
	imageUrl?: string;
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
	/** Context.dev (live): JSON extraction of brand and retailer pages; absent = those are not read. */
	contextdev?: WebCall;
	/** The brand's own web domain (Context.dev brand lookup), searched first; absent = retailers only. */
	brandDomain?: (brand: string) => Promise<string | null>;
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

type Target = Pick<Product, 'productId' | 'nameFi' | 'gtin'> & Partial<Pick<Product, 'brand'>>;

const hostOf = (url: string) => new URL(url).host.replace(/^www\./, '');
const asList = (v: unknown) =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined;
const asText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The stated facts of an extraction, only the fields it had. */
export function factsOf(x: ExtractedPage): PageFacts | undefined {
	const allergens = asList(x.allergens);
	const mayContain = asList(x.mayContain);
	const f: PageFacts = {
		...(asText(x.ingredients) ? { ingredients: asText(x.ingredients) } : {}),
		...(allergens?.length ? { allergens } : {}),
		...(mayContain?.length ? { mayContain } : {}),
		...(asText(x.origin) ? { origin: asText(x.origin) } : {}),
		...(asText(x.netQuantity) ? { netQuantity: asText(x.netQuantity) } : {})
	};
	return Object.keys(f).length ? f : undefined;
}

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
					host: 'valioaimo.fi',
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
			host: 'openfoodfacts.org',
			verifiedBy: 'gtin',
			checkedAt: now().toISOString()
		};
	}

	/**
	 * The brand's own site, then Finnish retailers: Exa finds candidate pages (by GTIN, then brand and name), Context.dev
	 * extracts each page's EAN, photo and stated facts. A page counts only when its EAN equals the GTIN; the brand's own
	 * page wins over a retailer's.
	 */
	async function wider(p: Target): Promise<ProductListing | null> {
		if (!d.exa || !d.contextdev) return null;
		const brandSite =
			p.brand && d.brandDomain ? await d.brandDomain(p.brand).catch(() => null) : null;
		const domains = [...(brandSite ? [brandSite] : []), ...RETAILERS];
		const urls: string[] = [];
		for (const query of [`"${p.gtin}"`, `${p.brand ?? ''} ${p.nameFi}`.trim()]) {
			const r = await d.exa<{ results?: { url?: string }[] }>(
				'/search',
				{ query, type: 'auto', numResults: 4, includeDomains: domains },
				{ purpose: 'product page, brand or retailer' }
			);
			for (const x of r.body.results ?? [])
				if (x.url && /^https:\/\//.test(x.url)) urls.push(x.url);
			if (urls.length) break;
		}
		const own = (u: string) => !!brandSite && hostOf(u).endsWith(brandSite.replace(/^www\./, ''));
		const ordered = [...new Set(urls)].sort((a, b) => Number(own(b)) - Number(own(a))).slice(0, 3);
		for (const url of ordered) {
			const r = await d
				.contextdev<{ json?: { success?: boolean | null; data?: ExtractedPage | null } }>(
					'/web/scrape',
					{
						url,
						formats: { json: true },
						sharedParams: { mainContentOnly: true },
						jsonParams: { schema: PRODUCT_PAGE_SCHEMA, instructions: PRODUCT_PAGE_INSTRUCTIONS }
					},
					{
						maxAgeMs: WEEK_MS,
						purpose: 'product page EAN, photo and facts',
						accept: (b) => !!(b as { json?: { success?: boolean } } | null)?.json?.success
					}
				)
				.catch(() => null);
			const x = r?.body.json?.data;
			if (!x || !sameGtin(x.ean, p.gtin)) continue;
			const facts = factsOf(x);
			return {
				pageUrl: url,
				...(x.imageUrl && /^https:\/\//.test(x.imageUrl) ? { imageUrl: x.imageUrl } : {}),
				source: own(url) ? 'manufacturer' : 'retailer',
				host: hostOf(url),
				verifiedBy: 'gtin',
				...(facts ? { facts } : {}),
				checkedAt: now().toISOString()
			};
		}
		return null;
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
		// Valio Aimo's own page first (cheap, the wholesaler's photo); then the brand's site or a retailer (Exa +
		// Context.dev); then Open Food Facts. A verified page without a photo still counts, but a later one with a
		// photo is preferred.
		let listing: ProductListing | null = null;
		for (const step of [valioAimo, wider, openFoodFacts]) {
			const l = await step(p).catch(() => null);
			if (l && (l.imageUrl || !listing)) listing = l;
			if (listing?.imageUrl) break;
		}
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
