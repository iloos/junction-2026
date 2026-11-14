/**
 * Product photos for rows and cards (web/photo.ts holds the ladder):
 * - `photosFor`: the ladder from what is already known (recorded listings, kept findings, brand logos). Never a call,
 *   so a page full of rows costs nothing. The kitchen's /kitchen-api/thumbs reads this.
 * - `warmPhotos`: the live part, run in the background when a plan is created or re-priced: verified pages (Valio
 *   Aimo, the brand, retailers, Open Food Facts) and brand logos, within the caller's web caps, so the rows' photos
 *   are ready when they render. An EAN-verified page's stated facts are filed as evidence (D6: never written into the
 *   catalogue; a web fact may add a caution, never clear one).
 */
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { findingsFor } from '../web';
import type { ProductListing } from '../web/listing';
import { familyKey, photoOf, type BrandFacts, type ProductPhoto } from '../web/photo';
import type { Suggestion } from '../web/lookup';
import { recordedIds, recordedListing } from './card';
import { brandLookup, listingFinder } from './index';

type Env = Record<string, string | undefined>;

/** A listing already known: prewarmed for the demo, else kept by a live lookup. Never a call. */
export function knownListing(env: Env, productId: string): ProductListing | null | undefined {
	const r = recordedListing(productId);
	if (r?.imageUrl) return r;
	// A live lookup (the brand's site, a retailer) can find what the recording didn't: a kept page wins over a
	// recorded "none".
	const kept = findingsFor(env).get(`listing:${productId}`)?.data as
		{ listing?: ProductListing | null } | undefined;
	if (kept?.listing) return kept.listing;
	return r !== undefined ? r : kept ? null : undefined;
}

/** Every known listing with a photo, by product id. */
function knownPhotos(env: Env): Map<string, ProductListing> {
	const out = new Map<string, ProductListing>();
	for (const f of findingsFor(env).list('listing')) {
		if (!f.id.startsWith('listing:')) continue;
		const l = (f.data as { listing?: ProductListing | null } | undefined)?.listing;
		if (l?.imageUrl) out.set(f.id.slice('listing:'.length), l);
	}
	for (const id of recordedIds()) {
		const l = recordedListing(id);
		if (l?.imageUrl) out.set(id, l);
	}
	return out;
}

/** The family index: familyKey → a product of that family with a verified photo. Rebuilt when the known set grows. */
let familyIndex: {
	size: number;
	byKey: Map<string, { productId: string; nameFi: string; listing: ProductListing }>;
} | null = null;
async function families(env: Env, catalog: Catalog) {
	const photos = knownPhotos(env);
	if (familyIndex && familyIndex.size === photos.size) return familyIndex.byKey;
	const products = await catalog.get([...photos.keys()]);
	const byKey = new Map<string, { productId: string; nameFi: string; listing: ProductListing }>();
	for (const [id, listing] of photos) {
		const p = products.get(id);
		const k = p ? familyKey(p) : null;
		if (p && k && !byKey.has(k)) byKey.set(k, { productId: id, nameFi: p.nameFi, listing });
	}
	familyIndex = { size: photos.size, byKey };
	return byKey;
}

function keptBrand(env: Env, brand: string | undefined): BrandFacts | null {
	if (!brand) return null;
	return (findingsFor(env).get(`brand:${brand.trim().toLowerCase()}`)?.data as BrandFacts) ?? null;
}

/** The photo ladder for each id, from known data only. Unknown ids are left out. */
export async function photosFor(
	env: Env,
	catalog: Catalog,
	ids: readonly string[]
): Promise<Record<string, ProductPhoto>> {
	const products = await catalog.get([...new Set(ids)]);
	const fams = await families(env, catalog);
	const out: Record<string, ProductPhoto> = {};
	for (const id of ids) {
		const p = products.get(id);
		if (!p) continue;
		const listing = knownListing(env, id);
		const k = familyKey(p);
		const fam = k ? fams.get(k) : undefined;
		const b = keptBrand(env, p.brand);
		out[id] = photoOf({
			listing,
			family: fam && fam.productId !== id ? fam : null,
			brandLogo: b?.logoUrl ? { url: b.logoUrl, domain: b.domain ?? undefined } : null,
			category: p.category
		});
	}
	return out;
}

/** An EAN-verified page's stated facts as evidence suggestions (the shape lookup_facts files). */
export function pageFactsSuggestions(l: ProductListing): Suggestion[] {
	const f = l.facts;
	if (!f || l.verifiedBy !== 'gtin') return [];
	const src = (quote: string) => [
		{ url: l.pageUrl, title: l.host ?? l.pageUrl, quote: quote.slice(0, 300), gtinCited: true }
	];
	const out: Suggestion[] = [];
	if (f.allergens?.length)
		out.push({
			field: 'allergens',
			value: f.allergens,
			gtinCited: true,
			sources: src(f.allergens.join(', '))
		});
	if (f.mayContain?.length)
		out.push({
			field: 'mayContain',
			value: f.mayContain,
			gtinCited: true,
			sources: src(f.mayContain.join(', '))
		});
	if (f.ingredients)
		out.push({
			field: 'ingredients',
			value: f.ingredients,
			gtinCited: true,
			sources: src(f.ingredients)
		});
	if (f.origin)
		out.push({ field: 'origin', value: f.origin, gtinCited: true, sources: src(f.origin) });
	if (f.netQuantity)
		out.push({
			field: 'netContent',
			value: f.netQuantity,
			gtinCited: true,
			sources: src(f.netQuantity)
		});
	return out;
}

/**
 * Prefetch spends from its own key and stops early: per workspace 24 calls a day per API, and none once the instance
 * has sent 300 calls of that API today (of the 1000 global default), so warming photos for a full room never takes
 * the budget that live lookups, the recall monitor and judges need.
 */
export const PREFETCH_LIMITS = { perKey: 24, global: 300 } as const;

/** Products already warmed in this process, so a re-plan doesn't repeat them. */
const warmed = new Set<string>();
const WARM_CAP = 2000;

/**
 * Warm photos and brand logos for products (live, within the caller's web cap), one at a time so a plan's lines
 * don't burst the provider limits. No-op in fixture mode. Returns how many were looked up.
 */
export async function warmPhotos(
	env: Env,
	spendKey: string,
	products: readonly Product[],
	max = 12
): Promise<number> {
	const find = listingFinder(env, spendKey, PREFETCH_LIMITS);
	if (!find) return 0;
	const brand = brandLookup(env, spendKey, PREFETCH_LIMITS);
	const findings = findingsFor(env);
	let n = 0;
	for (const p of products) {
		if (n >= max || warmed.size >= WARM_CAP) break;
		// The recording has a photo: nothing to warm. A recorded "none" predates the brand and retailer search, so it
		// is looked up again (and the brand logo fetched when that finds nothing).
		if (warmed.has(p.productId) || recordedListing(p.productId)?.imageUrl) continue;
		warmed.add(p.productId);
		n += 1;
		const listing = await find(p).catch(() => null);
		const facts = listing ? pageFactsSuggestions(listing) : [];
		if (listing && facts.length)
			findings.put({
				id: `facts:${p.productId}:page`,
				kind: 'facts',
				at: new Date().toISOString(),
				title: `Facts for ${p.nameFi} (${listing.host ?? 'product page'}, EAN-verified)`,
				sources: [listing.pageUrl],
				data: { suggestions: facts, eanVerified: true, fetchedAt: listing.checkedAt }
			});
		if (!listing?.imageUrl && p.brand && brand) await brand(p.brand).catch(() => null);
	}
	return n;
}
