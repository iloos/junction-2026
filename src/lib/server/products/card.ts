/**
 * One product's card, as the shared ProductToken opens it: pack and sales unit, price ex VAT, availability in words
 * (unknown supply said plainly), the allergen and diet record, origin, Valio's own substitutes, and the product's
 * public Valio Aimo listing when one is confirmed. Read-only. Valio terms come from the catalogue port (live or
 * cached, as it says); the listing from web/listing.ts (live or recorded).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Offer, Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import type { PublicListing } from '../web/listing';

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
	listing: PublicListing | null;
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

let recorded: Record<string, Omit<PublicListing, 'source'> | null> | null = null;
/** The demo products' listings, recorded from live reads; undefined for a product not recorded. */
export function recordedListing(productId: string): PublicListing | null | undefined {
	recorded ??= (
		JSON.parse(
			readFileSync(join(process.cwd(), 'src/lib/server/web/fixtures/listings.json'), 'utf-8')
		) as { listings: Record<string, Omit<PublicListing, 'source'> | null> }
	).listings;
	if (!(productId in recorded)) return undefined;
	const l = recorded[productId];
	return l ? { ...l, source: 'fixture' } : null;
}

export async function productCard(
	productId: string,
	d: {
		catalog: Catalog;
		deliverBy: string;
		/** The listing finder (live), or absent for the recorded set. */
		listing?: (p: Product) => Promise<PublicListing | null>;
	}
): Promise<ProductCard | null> {
	const p = (await d.catalog.get([productId])).get(productId);
	if (!p) return null;
	const subIds = p.valioSubstitutes.slice(0, 5);
	const [{ offers }, subs, listing] = await Promise.all([
		d.catalog.offers([productId], d.deliverBy),
		subIds.length ? d.catalog.get(subIds) : Promise.resolve(new Map<string, Product>()),
		d.listing ? d.listing(p).catch(() => undefined) : Promise.resolve(recordedListing(productId))
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
							? 'No recorded public listing for this product in demo mode.'
							: 'No public Valio Aimo page names this exact product.'
				})
	};
}
