/**
 * The picture a product row shows, and what it is. A ladder, each tier labelled on the image:
 *   gtin     the product's own photo from a page whose EAN equals its GTIN (Valio Aimo, the brand, a retailer, OFF)
 *   family   the same brand, base and form in another pack size, with a verified photo: "Pack may differ"
 *   brand    the brand's logo (Context.dev brand lookup): "Brand image"
 *   category an icon for the product's family (milk, fish …): "No photo"
 * Never another brand's photo as if it were this product: family needs the same brand. Hotlinked, never copied.
 */
import type { Product } from '$lib/core/contracts';
import { baseKeyOf } from '$lib/core/demand/basekey';
import { inCategoryGroup } from '$lib/core/mandate/categories';
import type { WebCall } from './http';
import type { ProductListing } from './listing';

export type PhotoMatch = 'gtin' | 'family' | 'brand' | 'category';
export type CategoryIcon =
	'milk' | 'cheese' | 'butter' | 'fish' | 'meat' | 'produce' | 'bakery' | 'frozen' | 'product';

export interface ProductPhoto {
	match: PhotoMatch;
	/** Absent for `category`: draw the icon. */
	imageUrl?: string;
	icon?: CategoryIcon;
	/** The label on the image; null for the product's own photo. */
	label: 'Pack may differ' | 'Brand image' | 'No photo' | null;
	/** Where the image comes from ("valioaimo.fi", "s-kaupat.fi", "context.dev"), for the UI and the sponsor claims. */
	host?: string;
	pageUrl?: string;
	/** For `family`: the product whose photo this is. */
	sameAs?: { productId: string; nameFi: string };
}

type KeyInput = Pick<Product, 'nameFi' | 'temperatureClass'> &
	Partial<Pick<Product, 'brand' | 'netPerSalesUnit' | 'netVolumePerSalesUnit' | 'category'>>;

/**
 * Brand + base + form + temperature: one family across pack sizes. Null without a brand (a family photo must be the
 * same brand) or without a parsed base.
 */
export function familyKey(p: KeyInput): string | null {
	const brand = p.brand?.trim().toLowerCase();
	if (!brand) return null;
	const k = baseKeyOf(p);
	if (!k.base || k.baseSource === 'unknown') return null;
	return [brand, k.base, [...k.form].sort().join('+'), k.temperatureClass].join('|');
}

/**
 * Valio category prefixes for the icons beyond the rule families (team mapping from product names per category,
 * checked against the catalogue on 15 Nov: "juusto" 106xx, "voi" 105xx, bread 109xx–110xx, frozen 417xx–418xx).
 */
const ICON_PREFIXES: [CategoryIcon, string[]][] = [
	['cheese', ['106']],
	['butter', ['105']],
	['bakery', ['109', '110']],
	['frozen', ['417', '418']]
];

export function categoryIcon(category: string | undefined): CategoryIcon {
	if (!category) return 'product';
	for (const g of ['milk', 'fish', 'meat', 'produce'] as const)
		if (inCategoryGroup(category, g)) return g;
	for (const [icon, prefixes] of ICON_PREFIXES)
		if (prefixes.some((p) => category.startsWith(p))) return icon;
	return 'product';
}

/** The ladder: the first tier that has a picture. */
export function photoOf(i: {
	listing: ProductListing | null | undefined;
	family?: { productId: string; nameFi: string; listing: ProductListing } | null;
	brandLogo?: { url: string; domain?: string } | null;
	category?: string;
}): ProductPhoto {
	const host = (u: string) => {
		try {
			return new URL(u).host.replace(/^www\./, '');
		} catch {
			return undefined;
		}
	};
	if (i.listing?.imageUrl)
		return {
			match: 'gtin',
			imageUrl: i.listing.imageUrl,
			label: null,
			host: i.listing.host ?? host(i.listing.pageUrl),
			pageUrl: i.listing.pageUrl
		};
	if (i.family?.listing.imageUrl)
		return {
			match: 'family',
			imageUrl: i.family.listing.imageUrl,
			label: 'Pack may differ',
			host: i.family.listing.host ?? host(i.family.listing.pageUrl),
			pageUrl: i.family.listing.pageUrl,
			sameAs: { productId: i.family.productId, nameFi: i.family.nameFi }
		};
	if (i.brandLogo?.url)
		return {
			match: 'brand',
			imageUrl: i.brandLogo.url,
			label: 'Brand image',
			host: i.brandLogo.domain ?? 'context.dev'
		};
	return { match: 'category', icon: categoryIcon(i.category), label: 'No photo' };
}

export interface BrandFacts {
	domain: string | null;
	logoUrl: string | null;
}

const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * A brand's web domain and logo by name (Context.dev `POST /brand/retrieve`, `by_name`), cached a week through the
 * outside-call helper (traced, capped). Null fields when Context.dev doesn't know the brand.
 */
export function createBrandLookup(contextdev: WebCall) {
	return async function brand(name: string): Promise<BrandFacts> {
		const r = await contextdev<{
			brand?: { domain?: string; logos?: { url?: string; type?: string; mode?: string }[] };
		}>(
			'/brand/retrieve',
			{ type: 'by_name', name },
			{ maxAgeMs: WEEK_MS, purpose: 'brand logo and domain' }
		);
		const b = r.body.brand;
		const logos = (b?.logos ?? []).filter((l) => l.url && /^https:\/\//.test(l.url));
		// A full logo before an icon; one for light backgrounds first.
		const pick =
			logos.find((l) => l.type === 'logo' && l.mode !== 'dark') ??
			logos.find((l) => l.type === 'logo') ??
			logos[0];
		return { domain: b?.domain?.replace(/^www\./, '') ?? null, logoUrl: pick?.url ?? null };
	};
}
