import { beforeEach, describe, expect, it } from 'vitest';
import { resetBreakers } from '../external/breaker';
import { resetExternalCache } from '../external/call';
import { createDbPorts } from '../store/db-ports';
import { productCard, recordedListing } from '../products/card';
import { confirm, createListingFinder, listingSlug, parseListingPage } from './listing';

const page = (title: string, ean?: string, img = true) =>
	`<html><head><title>${title} - Valio Aimo</title>${img ? '<meta property="og:image" content="https://api.valioaimo.fi/medias/x.jpg" />' : ''}</head><body><h1>${title}</h1>${ean ? `<dt>EAN-koodi</dt><dd>${ean}</dd>` : ''}</body></html>`;

const ham = {
	productId: '476768',
	nameFi: 'HK Palvikinkku viipaloitu 1,5 kg',
	brand: 'HK',
	gtin: '6409100045821'
};

beforeEach(() => {
	resetExternalCache();
	resetBreakers();
});

describe('public Valio Aimo listing', () => {
	it('slugs a name the way the site does and reads title, EAN and image', () => {
		expect(listingSlug(ham.nameFi)).toBe('hk-palvikinkku-viipaloitu-15-kg');
		expect(listingSlug('Arla Café maito 1 L UHT laktoositon')).toBe(
			'arla-cafe-maito-1-l-uht-laktoositon'
		);
		const p = parseListingPage('u', page(ham.nameFi, ham.gtin))!;
		expect(p).toMatchObject({ title: ham.nameFi, ean: ham.gtin });
		expect(p.imageUrl).toMatch(/^https:/);
	});

	it('confirms a page only when it names the same product: EAN first, else the exact name', () => {
		expect(confirm({ url: 'u', title: 'whatever', ean: ham.gtin }, ham)).toBe('gtin');
		expect(confirm({ url: 'u', title: ham.nameFi, ean: '6409100045999' }, ham)).toBeNull();
		expect(confirm({ url: 'u', title: 'HK Palvikinkku viipaloitu 1.5 kg' }, ham)).toBe('name');
		expect(confirm({ url: 'u', title: 'HK Palvikinkku viipaloitu 3 kg' }, ham)).toBeNull();
	});

	it('finds the page at the name slug, keeps its image, and caches the verdict', async () => {
		const asked: string[] = [];
		const find = createListingFinder({
			getPage: async (url) => {
				asked.push(url);
				return url.endsWith('/hk-palvikinkku-viipaloitu-15-kg/')
					? page(ham.nameFi, ham.gtin)
					: null;
			}
		});
		const l = await find(ham);
		expect(l).toMatchObject({
			url: 'https://www.valioaimo.fi/toimitustukku/hk-palvikinkku-viipaloitu-15-kg/',
			match: 'gtin',
			source: 'live'
		});
		expect(l?.imageUrl).toMatch(/^https:/);
		expect((await find(ham))?.source).toBe('cache');
		expect(asked).toHaveLength(1);
	});

	it('a page for another product is no listing, and shows no image', async () => {
		const find = createListingFinder({
			getPage: async () => page('HK Palvikinkku 3 kg', '1234567890123')
		});
		expect(await find(ham)).toBeNull();
	});

	it('the card carries the recorded listing for the demo products, or says there is none', async () => {
		expect(recordedListing('476768')).toMatchObject({ match: 'gtin', source: 'fixture' });
		expect(recordedListing('464411')).toBeNull(); // Valio voi: no public page names it
		const env = await createDbPorts({ runId: 'run-card' });
		const card = await productCard('476768', {
			catalog: env.ports.catalog,
			deliverBy: '2026-12-10'
		});
		expect(card).toMatchObject({ productId: '476768', listing: { match: 'gtin' } });
		expect(card?.availability.words.length).toBeGreaterThan(5);
		const butter = await productCard('464411', {
			catalog: env.ports.catalog,
			deliverBy: '2026-12-10'
		});
		expect(butter?.listing).toBeNull();
		expect(butter?.listingNote).toMatch(/No public Valio Aimo page/);
	}, 30_000);
});
