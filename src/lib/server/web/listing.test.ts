import { beforeEach, describe, expect, it } from 'vitest';
import { resetBreakers } from '../external/breaker';
import { resetExternalCache } from '../external/call';
import { createDbPorts } from '../store/db-ports';
import { productCard, recordedListing } from '../products/card';
import { createFindings } from './findings';
import type { WebCall } from './http';
import { createListingFinder, listingSlug, parseListingPage, sameGtin } from './listing';

const page = (title: string, ean?: string) =>
	`<html><head><title>${title} - Valio Aimo</title><meta property="og:image" content="https://imgfly.example/x.jpg" /></head><body><h1>${title}</h1>${ean ? `<dt>EAN-koodi</dt><dd>${ean}</dd>` : ''}<a href="https://toimitustukku.valioaimo.fi/fi/hk-palvikinkku/p/9901826">Osta</a></body></html>`;

const ham = {
	productId: '476768',
	nameFi: 'HK Palvikinkku viipaloitu 1,5 kg',
	gtin: '6409100045821'
};
const HAM_URL = 'https://www.valioaimo.fi/toimitustukku/hk-palvikinkku-viipaloitu-15-kg/';

/** An Exa search that returns the given URLs and counts its calls. */
const fakeExa = (urls: string[], calls: string[]) =>
	(async (_path: string, body: { query: string }) => {
		calls.push(body.query);
		return { body: { results: urls.map((url) => ({ url })) } };
	}) as unknown as WebCall;

beforeEach(() => {
	resetExternalCache();
	resetBreakers();
});

describe('public product page, verified by GTIN', () => {
	it('slugs a name like the site, reads EAN, photo and webshop link, and compares barcodes', () => {
		expect(listingSlug(ham.nameFi)).toBe('hk-palvikinkku-viipaloitu-15-kg');
		expect(listingSlug('Arla Café maito 1 L UHT laktoositon')).toBe(
			'arla-cafe-maito-1-l-uht-laktoositon'
		);
		const p = parseListingPage('u', page(ham.nameFi, ham.gtin))!;
		expect(p).toMatchObject({ ean: ham.gtin, shopUrl: expect.stringMatching(/\/p\/9901826$/) });
		expect(p.imageUrl).toMatch(/^https:/);
		expect(sameGtin('06409100045821', ham.gtin)).toBe(true);
		expect(sameGtin('6409100045822', ham.gtin)).toBe(false);
	});

	it('finds the page by GTIN through Exa, accepts it only on the same EAN, and keeps it as a finding', async () => {
		const calls: string[] = [];
		const findings = createFindings(undefined, true);
		const find = createListingFinder({
			exa: fakeExa([HAM_URL], calls),
			getPage: async (url) => (url === HAM_URL ? page(ham.nameFi, ham.gtin) : null),
			findings
		});
		const l = await find(ham);
		expect(calls[0]).toBe(`"${ham.gtin}" site:valioaimo.fi`);
		expect(l).toMatchObject({ pageUrl: HAM_URL, source: 'valioaimo', verifiedBy: 'gtin' });
		expect(l?.imageUrl).toMatch(/^https:/);
		expect(findings.get('listing:476768')).toMatchObject({ kind: 'listing' });
		await find(ham); // the finding answers: no second search
		expect(calls).toHaveLength(1);
	});

	it('a page with another barcode is no match and gives no image; Open Food Facts answers by barcode', async () => {
		const find = createListingFinder({
			exa: fakeExa([HAM_URL], []),
			getPage: async () => page(ham.nameFi, '6409100045999'),
			getJson: async () => ({
				status: 1,
				product: { code: ham.gtin, image_front_url: 'https://images.openfoodfacts.org/x.jpg' }
			})
		});
		expect(await find(ham)).toMatchObject({
			source: 'openfoodfacts',
			pageUrl: `https://world.openfoodfacts.org/product/${ham.gtin}`,
			imageUrl: 'https://images.openfoodfacts.org/x.jpg'
		});
		resetExternalCache(); // the Open Food Facts answer above is cached per barcode
		const none = createListingFinder({
			getPage: async () => page(ham.nameFi, '1'),
			getJson: async () => ({ status: 0 })
		});
		expect(await none(ham)).toBeNull();
	});

	it('the card serves the prewarmed pages for the demo products, or says there is none', async () => {
		expect(recordedListing('476768')).toMatchObject({ source: 'valioaimo', verifiedBy: 'gtin' });
		const env = await createDbPorts({ runId: 'run-card' });
		const card = await productCard('476768', {
			catalog: env.ports.catalog,
			deliverBy: '2026-12-10'
		});
		expect(card).toMatchObject({ productId: '476768', listing: { source: 'valioaimo' } });
		expect(card?.availability.words.length).toBeGreaterThan(5);
		const unknown = await productCard('460879', {
			catalog: env.ports.catalog,
			deliverBy: '2026-12-10'
		});
		expect(unknown?.listing).toBeNull();
		expect(unknown?.listingNote).toMatch(/No public page carries/);
	}, 30_000);
});
