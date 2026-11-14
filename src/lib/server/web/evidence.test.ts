import { describe, expect, it } from 'vitest';
import { createDbPorts } from '../store/db-ports';
import type { NewsSource } from './contextdev';
import { cleanQuote, factsEvidence, makeInHouse, supplierLeads } from './evidence';
import { unresolved } from '$lib/ui/why-evidence';
import { createFindings } from './findings';
import { createFixtureFactSearch } from './fixture';
import { lookupFacts } from './lookup';

describe('web evidence for the UI (recorded answers, no network)', { timeout: 30_000 }, () => {
	it('Why drawer: no allergen record → cited web fields, GTIN-cited first, labelled replay', async () => {
		const env = await createDbPorts({ runId: 'run-evidence' });
		const r = await lookupFacts(
			{ productId: '460002' },
			{
				exa: createFixtureFactSearch(),
				catalog: env.ports.catalog,
				findings: createFindings(undefined, true)
			}
		);
		const e = factsEvidence(r);
		expect(e).toMatchObject({
			productId: '460002',
			gap: 'no_allergen_record',
			catalogue: 'Valio has no allergen record for this product',
			source: 'replay'
		});
		expect(e.fields.length).toBeGreaterThan(0);
		expect(e.fields[0].gtinCited).toBe(true);
		const s = e.fields[0].sources[0];
		expect(s.host).not.toMatch(/^www\./);
		expect(s.quote).toBeTruthy();
		expect(e.disclaimer).toMatch(/never clear a hold/);
	});

	it('make in house: outside recipe → catalogue ingredients → a held proposal', async () => {
		const env = await createDbPorts({ runId: 'run-mih' });
		const p = await makeInHouse('joulutorttu', {
			exa: createFixtureFactSearch(),
			catalog: env.ports.catalog,
			findings: createFindings(undefined, true)
		});
		expect(p.status).toBe('held');
		expect(p.reasons).toContain('new_sku');
		expect(p.recipe?.url).toMatch(/^https:\/\//);
		expect(p.coverage.total).toBe(p.ingredients.length);
		expect(p.coverage.resolved).toBeGreaterThan(0);
		expect(p.source).toBe('replay');
	});

	it('supplier leads: recent news per vendor, newest first; fixture mode reads none', async () => {
		const news: NewsSource = {
			mode: 'live',
			async searchNews(company) {
				if (company === 'Unknown Oy') throw new Error('context.dev 404');
				return {
					cached: false,
					articles: [
						{
							url: 'https://yle.fi/a/1',
							title: `${company} recalls a batch`,
							published_at: '2026-11-10T08:00:00Z',
							source: { domain: 'yle.fi' },
							match: { level: 'primary', confidence: 0.9 }
						},
						{ url: 'https://old.fi/x', title: 'old', published_at: '2025-01-01T00:00:00Z' }
					]
				};
			}
		};
		const r = await supplierLeads(['Valio', 'Valio', 'Unknown Oy', 'HK Foods'], news, {
			now: new Date('2026-11-14T12:00:00Z')
		});
		expect(r.vendors).toEqual(['Valio', 'Unknown Oy', 'HK Foods']);
		expect(r.leads.map((l) => l.vendor)).toEqual(['Valio', 'HK Foods']);
		expect(r.leads[0]).toMatchObject({ host: 'yle.fi', level: 'primary' });
		expect(r.source).toBe('live');
		expect(r.note).toMatch(/1 supplier\(s\) could not be searched/);
		const none = await supplierLeads(['Valio'], {
			mode: 'fixture',
			searchNews: async () => ({ articles: [], cached: false })
		});
		expect(none).toMatchObject({ source: 'none', leads: [] });
	});

	it('quotes read as one line; an out or undeliverable line offers a web recipe', () => {
		expect(
			cleanQuote(`| Pakkauskoko | n. 6,5-8,5 kg |
| --- | --- |
### Ainesosat

Tomaatti 51%`)
		).toBe('Pakkauskoko · n. 6,5-8,5 kg · Ainesosat Tomaatti 51%');
		expect(unresolved({ state: 'unorderable', reasons: ['out'] })).toBe(true);
		expect(unresolved({ state: 'eligible', reasons: [] })).toBe(false);
	});
});
