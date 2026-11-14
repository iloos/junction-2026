import { beforeEach, describe, expect, it } from 'vitest';
import { resetBreakers } from '../external/breaker';
import { resetExternalCache } from '../external/call';
import type { WebCall } from './http';
import { createListingFinder, type ProductListing } from './listing';
import { categoryIcon, createBrandLookup, familyKey, photoOf } from './photo';
import { pageFactsSuggestions } from '../products/photos';

const L = (over: Partial<ProductListing> = {}): ProductListing => ({
	pageUrl: 'https://www.valioaimo.fi/toimitustukku/x/',
	imageUrl: 'https://img.example/x.jpg',
	source: 'valioaimo',
	host: 'valioaimo.fi',
	verifiedBy: 'gtin',
	checkedAt: '2026-11-15T00:00:00Z',
	...over
});
const P = (nameFi: string, brand?: string) => ({
	nameFi,
	brand,
	temperatureClass: 'chilled' as const
});

beforeEach(() => {
	resetExternalCache();
	resetBreakers();
});

describe('photo ladder', () => {
	it('uses the product’s own verified photo first, with no label', () => {
		expect(photoOf({ listing: L() })).toMatchObject({
			match: 'gtin',
			label: null,
			host: 'valioaimo.fi'
		});
	});

	it('falls back to a same-family photo, then the brand logo, then the category icon, each labelled', () => {
		const family = { productId: '2', nameFi: 'HK Palvikinkku 3 kg', listing: L() };
		expect(photoOf({ listing: null, family })).toMatchObject({
			match: 'family',
			label: 'Pack may differ',
			sameAs: { productId: '2' }
		});
		expect(
			photoOf({ listing: null, brandLogo: { url: 'https://logo.example/hk.png', domain: 'hk.fi' } })
		).toMatchObject({
			match: 'brand',
			label: 'Brand image',
			host: 'hk.fi'
		});
		expect(photoOf({ listing: null, category: '10400' })).toEqual({
			match: 'category',
			icon: 'milk',
			label: 'No photo'
		});
		// A verified page with no photo does not count as a photo.
		expect(photoOf({ listing: L({ imageUrl: undefined }), category: '18701' })).toMatchObject({
			match: 'category',
			icon: 'fish'
		});
	});

	it('groups pack sizes of one brand into one family, never across brands', () => {
		const a = familyKey(P('HK Palvikinkku viipaloitu 1,5 kg', 'HK'));
		expect(a).toBeTruthy();
		expect(familyKey(P('HK Palvikinkku viipaloitu 3 kg', 'HK'))).toBe(a);
		expect(familyKey(P('Atria Palvikinkku viipaloitu 1,5 kg', 'Atria'))).not.toBe(a);
		// No brand: no family (a family photo must be the same brand).
		expect(familyKey(P('Palvikinkku viipaloitu 1,5 kg'))).toBeNull();
	});

	it('maps categories to icons, unknown to a plain product icon', () => {
		expect(categoryIcon('10600')).toBe('cheese');
		expect(categoryIcon('17201')).toBe('meat');
		expect(categoryIcon(undefined)).toBe('product');
		expect(categoryIcon('99999')).toBe('product');
	});

	it('reads a brand’s domain and logo from Context.dev, a full logo first', async () => {
		const calls: unknown[] = [];
		const cd = (async (path: string, body: unknown) => {
			calls.push({ path, body });
			return {
				body: {
					brand: {
						domain: 'www.hk.fi',
						logos: [
							{ url: 'https://cdn.example/icon.png', type: 'icon' },
							{ url: 'https://cdn.example/logo.png', type: 'logo', mode: 'light' }
						]
					}
				}
			};
		}) as unknown as WebCall;
		expect(await createBrandLookup(cd)('HK')).toEqual({
			domain: 'hk.fi',
			logoUrl: 'https://cdn.example/logo.png'
		});
		expect(calls[0]).toMatchObject({
			path: '/brand/retrieve',
			body: { type: 'by_name', name: 'HK' }
		});
	});
});

describe('brand and retailer pages (Exa + Context.dev)', () => {
	const ham = {
		productId: '476768',
		nameFi: 'HK Palvikinkku viipaloitu 1,5 kg',
		gtin: '6409100045821',
		brand: 'HK'
	};
	const retailer = 'https://www.s-kaupat.fi/tuote/hk-palvikinkku/6409100045821';
	const own = 'https://www.hk.fi/tuotteet/palvikinkku';
	const exa = (urls: string[], seen: unknown[]) =>
		(async (_p: string, body: unknown) => {
			seen.push(body);
			return { body: { results: urls.map((url) => ({ url })) } };
		}) as unknown as WebCall;
	const cd = (pages: Record<string, { ean?: string; imageUrl?: string; allergens?: string[] }>) =>
		(async (_p: string, body: { url: string }) => ({
			body: { json: { success: true, data: pages[body.url] ?? null } }
		})) as unknown as WebCall;
	const noPage = async () => null;

	it('accepts a page only when its EAN equals the GTIN, prefers the brand’s own page, and keeps its facts', async () => {
		const seen: unknown[] = [];
		const find = createListingFinder({
			exa: exa([retailer, own], seen),
			contextdev: cd({
				[retailer]: { ean: ham.gtin, imageUrl: 'https://img.example/ret.jpg' },
				[own]: { ean: ham.gtin, imageUrl: 'https://img.example/own.jpg', allergens: ['maito'] }
			}),
			brandDomain: async () => 'hk.fi',
			getPage: noPage,
			getJson: noPage
		});
		const l = await find(ham);
		expect(l).toMatchObject({
			source: 'manufacturer',
			host: 'hk.fi',
			imageUrl: 'https://img.example/own.jpg'
		});
		expect(l?.facts).toEqual({ allergens: ['maito'] });
		// The brand's domain is searched with the retailers.
		expect(
			seen.some((b) => (b as { includeDomains: string[] }).includeDomains.includes('hk.fi'))
		).toBe(true);
		const s = pageFactsSuggestions(l!);
		expect(s).toEqual([
			expect.objectContaining({ field: 'allergens', value: ['maito'], gtinCited: true })
		]);
		expect(s[0].sources[0]).toMatchObject({ url: own, gtinCited: true });
	});

	it('rejects a page whose EAN differs, even with a photo', async () => {
		const find = createListingFinder({
			exa: exa([retailer], []),
			contextdev: cd({
				[retailer]: { ean: '6409100045822', imageUrl: 'https://img.example/x.jpg' }
			}),
			getPage: noPage,
			getJson: noPage
		});
		expect(await find(ham)).toBeNull();
	});
});
