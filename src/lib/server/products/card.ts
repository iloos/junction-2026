/**
 * One product's card, as the shared ProductToken opens it: pack and sales unit, price ex VAT, availability in words
 * (unknown supply said plainly), the allergen and diet record, origin, Valio's own substitutes, and the product's
 * public page (Valio Aimo, else Open Food Facts) when its barcode matches. Read-only. Valio terms come from the catalogue port (live or
 * cached, as it says); the listing from web/listing.ts (live or recorded).
 */
// Bundled into the build, so the served image has it (src/ is not shipped).
import listingsFile from '../web/fixtures/listings.json';
import type { Offer, Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import type { ProductListing } from '../web/listing';
import type { ProductPhoto } from '../web/photo';

export interface ProductCard {
	productId: string;
	nameFi: string;
	nameShort?: string;
	brand?: string;
	/** ISO country, e.g. "FI"; absent when Valio does not say. */
	origin?: string;
	/** "1 ST = 1.5 kg", "1 KG (sold by weight)". */
	pack: string;
	salesUnit: string;
	/** Ex VAT per sales unit, with the comparison price when Valio gives one; null = no price. */
	price: { cents: number; per: string; comparison?: { cents: number; unit: string } } | null;
	availability: {
		kind: Offer['availability']['kind'] | 'none';
		/** In words, e.g. "13 in stock at Valio", "Valio states no quantity (supplier-delivered)". */
		words: string;
	};
	/** Valio's own terms: live from the API, or the cached copy. */
	termsSource: string | null;
	diet: Pick<Product, 'nameFi' | 'allergens' | 'freeFrom' | 'diet'>;
	/** Valio's own substitution rules for this product. */
	substitutes: { productId: string; nameFi: string }[];
	listing: ProductListing | null;
	/** The picture to show and what it is (gtin / family / brand / category); set by the caller (cardFor). */
	photo?: ProductPhoto;
	/** Why there is no link, in words, when there is none. */
	listingNote?: string;
}

const UNIT_WORD: Record<string, string> = {
	ST: 'pack',
	KG: 'kg',
	BAG: 'bag',
	KI: 'case',
	PAK: 'pack',
	LTR: 'l'
};

function packText(p: Product): string {
	const net = p.netPerSalesUnit?.value;
	if (p.catchWeight || p.salesUnit === 'KG') return '1 kg (sold by weight)';
	if (net) return `1 ${UNIT_WORD[p.salesUnit] ?? p.salesUnit} = ${net.value} ${net.unit}`;
	return `1 ${UNIT_WORD[p.salesUnit] ?? p.salesUnit}`;
}

export function availabilityWords(
	o: Offer | undefined,
	salesUnit: string
): ProductCard['availability'] {
	const a = o?.availability;
	if (!a) return { kind: 'none', words: 'No Valio terms read for this delivery date' };
	const unit = UNIT_WORD[salesUnit] ?? salesUnit;
	switch (a.kind) {
		case 'known':
			return {
				kind: 'known',
				words:
					a.amount == null || a.amount >= 1e6
						? 'In stock at Valio (no limit stated)'
						: `${a.amount} ${unit}${a.amount === 1 ? '' : 's'} in stock at Valio`
			};
		case 'unknown':
			return {
				kind: 'unknown',
				words:
					'Valio states no quantity (supplier-delivered): it can be ordered, but nobody knows the stock'
			};
		case 'out':
			return { kind: 'out', words: 'Out of stock at Valio for this delivery' };
		case 'undeliverable':
			return {
				kind: 'undeliverable',
				words: "Valio can't deliver it to this kitchen on this date"
			};
		default:
			return { kind: a.kind, words: 'Blocked from ordering at Valio' };
	}
}

let recorded: Record<string, ProductListing | null> | null = null;
/**
 * The demo products' verified pages, prewarmed from live reads (scripts/web/prewarm-listings): the demo makes no live
 * call for them. undefined = not prewarmed.
 */
export function recordedListing(productId: string): ProductListing | null | undefined {
	recorded ??= (listingsFile as { listings: Record<string, ProductListing | null> }).listings;
	return productId in recorded ? recorded[productId] : undefined;
}

/** The product ids the recorded set knows (with or without a page). */
export function recordedIds(): string[] {
	recorded ??= (listingsFile as { listings: Record<string, ProductListing | null> }).listings;
	return Object.keys(recorded);
}

export async function productCard(
	productId: string,
	d: {
		catalog: Catalog;
		deliverBy: string;
		/** The listing finder (live), or absent for the recorded set. */
		listing?: (p: Product) => Promise<ProductListing | null>;
	}
): Promise<ProductCard | null> {
	const p = (await d.catalog.get([productId])).get(productId);
	if (!p) return null;
	const subIds = p.valioSubstitutes.slice(0, 5);
	const [{ offers }, subs, listing] = await Promise.all([
		d.catalog.offers([productId], d.deliverBy),
		subIds.length ? d.catalog.get(subIds) : Promise.resolve(new Map<string, Product>()),
		// Prewarmed demo products first (no live call), then the live finder when there is one.
		recordedListing(productId) !== undefined || !d.listing
			? Promise.resolve(recordedListing(productId))
			: d.listing(p).catch(() => undefined)
	]);
	const o = offers.find((x) => x.productId === productId);
	const unit = UNIT_WORD[p.salesUnit] ?? p.salesUnit;
	return {
		productId,
		nameFi: p.nameFi,
		...(p.nameShort ? { nameShort: p.nameShort.value } : {}),
		...(p.brand ? { brand: p.brand } : {}),
		...(p.origin ? { origin: p.origin.toUpperCase() } : {}),
		pack: packText(p),
		salesUnit: p.salesUnit,
		price: o?.price
			? {
					cents: o.price.unitCents,
					per: unit,
					...(o.price.comparison
						? { comparison: { cents: o.price.comparison.cents, unit: o.price.comparison.unit } }
						: {})
				}
			: null,
		availability: availabilityWords(o, p.salesUnit),
		termsSource: o?.price?.provenance.source ?? o?.availability.provenance.source ?? null,
		diet: { nameFi: p.nameFi, allergens: p.allergens, freeFrom: p.freeFrom, diet: p.diet },
		substitutes: subIds.flatMap((id) => {
			const s = subs.get(id);
			return s ? [{ productId: id, nameFi: s.nameFi }] : [];
		}),
		listing: listing ?? null,
		...(listing
			? {}
			: {
					listingNote:
						listing === undefined && !d.listing
							? 'No public page looked up for this product in demo mode.'
							: 'No public page carries this product’s barcode (Valio Aimo, Open Food Facts).'
				})
	};
}
