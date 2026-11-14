/**
 * A product's public listing on Valio Aimo's browse-only catalogue site (www.valioaimo.fi/toimitustukku/<slug>/,
 * which shows a product but can't take an order). Found in two ways, cheapest first: the page at the slug of the
 * product's own name, then an Exa search limited to valioaimo.fi. A candidate page counts only when it names the
 * same product: its EAN-koodi equals our GTIN, or (no EAN on the page) its title is our name. The page's image is
 * kept only for a passed match. Each page read and the verdict per product go through the shared outside-call helper:
 * cached (a week for a found listing, minutes for none), traced, charged to the caller's web cap.
 */
import type { Product } from '$lib/core/contracts';
import { createExternalCall, type CacheStore } from '../external/call';
import type { SpendGuard } from './spend';
import type { WebCall } from './http';

export const LISTING_HOST = 'https://www.valioaimo.fi';
const WEEK_MS = 7 * 24 * 3_600_000;

export interface PublicListing {
	url: string;
	title: string;
	/** How the page was confirmed as this product. */
	match: 'gtin' | 'name';
	/** The page's own product image (og:image), only for a confirmed match. */
	imageUrl?: string;
	/** live = read now; cache = an earlier read; fixture = recorded for the demo products. */
	source: 'live' | 'cache' | 'fixture';
}

export interface ListingPage {
	url: string;
	title: string;
	ean?: string;
	imageUrl?: string;
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

/** Title, EAN and image from a public product page's HTML. */
export function parseListingPage(url: string, html: string): ListingPage | null {
	const title = html
		.match(/<title>([^<]*)<\/title>/i)?.[1]
		?.replace(/\s*-\s*Valio Aimo\s*$/i, '')
		.trim();
	if (!title) return null;
	const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
	const ean = text.match(/EAN-koodi\s*(\d{8,14})/)?.[1];
	const image = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
	return {
		url,
		title: decode(title),
		...(ean ? { ean } : {}),
		...(image && /^https:\/\//.test(image) ? { imageUrl: decode(image) } : {})
	};
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'");

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/,/g, '.')
		.replace(/[^a-z0-9åäö.]+/g, ' ')
		.trim();

/** The page names this product: same GTIN, or no EAN on the page and the same name (pack included). */
export function confirm(
	page: ListingPage,
	p: Pick<Product, 'gtin' | 'nameFi'>
): 'gtin' | 'name' | null {
	const gtin = p.gtin?.replace(/\D/g, '');
	if (page.ean)
		return gtin && page.ean.replace(/^0+/, '') === gtin.replace(/^0+/, '') ? 'gtin' : null;
	return norm(page.title) === norm(p.nameFi) ? 'name' : null;
}

export interface ListingDeps {
	/** GET a public page; null for a 404. */
	getPage?: (url: string) => Promise<string | null>;
	/** Exa search restricted to valioaimo.fi (absent: slug only). */
	exa?: WebCall;
	store?: CacheStore;
	guard?: SpendGuard;
}

const pageGet = async (url: string): Promise<string | null> => {
	const res = await fetch(url, {
		headers: { 'user-agent': 'Mandate-demo/1.0 (public catalogue link check)' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`valioaimo.fi ${res.status}`);
	return res.text();
};

/** One product's public listing, or null when no page names this product. */
export function createListingFinder(d: ListingDeps = {}) {
	const pages = createExternalCall({
		api: 'other',
		name: 'valioaimo-public',
		store: d.store,
		// A 404 is an answer, not an outage.
		isOutage: () => true
	});
	const verdicts = createExternalCall({ api: 'other', name: 'valioaimo-listing', store: d.store });
	const get = d.getPage ?? pageGet;

	async function read(url: string): Promise<ListingPage | null> {
		const r = await pages<string | null>(
			{
				key: url,
				purpose: 'listing page',
				maxAgeMs: WEEK_MS,
				shortLived: (html) => html === null
			},
			async () => ({ value: await get(url) })
		);
		return r.value ? parseListingPage(url, r.value) : null;
	}

	async function candidates(p: Pick<Product, 'nameFi' | 'brand' | 'gtin'>): Promise<string[]> {
		const out = [`${LISTING_HOST}/toimitustukku/${listingSlug(p.nameFi)}/`];
		if (d.exa) {
			const r = await d.exa<{ results?: { url?: string }[] }>(
				'/search',
				{
					query: `${p.nameFi}${p.brand && !p.nameFi.includes(p.brand) ? ` ${p.brand}` : ''}`,
					type: 'auto',
					numResults: 5,
					includeDomains: ['valioaimo.fi']
				},
				{ purpose: 'listing search' }
			);
			for (const x of r.body.results ?? [])
				if (
					x.url &&
					/^https:\/\/www\.valioaimo\.fi\/(toimitustukku|ammattilaistuotteet)\//.test(x.url)
				)
					out.push(x.url.replace(/\.md$/, '/'));
		}
		return [...new Set(out)].slice(0, 5);
	}

	return async function find(
		p: Pick<Product, 'productId' | 'nameFi' | 'brand' | 'gtin'>
	): Promise<PublicListing | null> {
		const r = await verdicts<Omit<PublicListing, 'source'> | null>(
			{
				key: `${p.productId}:${p.gtin ?? ''}`,
				purpose: 'public listing',
				maxAgeMs: WEEK_MS,
				shortLived: (v) => v === null,
				detail: { productId: p.productId }
			},
			async () => {
				for (const url of await candidates(p)) {
					const page = await read(url).catch(() => null);
					if (!page) continue;
					const match = confirm(page, p);
					if (match)
						return {
							value: {
								url: page.url,
								title: page.title,
								match,
								...(page.imageUrl ? { imageUrl: page.imageUrl } : {})
							}
						};
				}
				return { value: null };
			}
		);
		return r.value ? { ...r.value, source: r.cache === 'cache' ? 'cache' : 'live' } : null;
	};
}
