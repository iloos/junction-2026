import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product, type ServerEvent } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { verifyContextSignature, sameSecret } from './contextdev';
import {
	createFixtureFactSearch,
	recordedNotice,
	EGG_RECALL_URL,
	createFixtureRecallSource
} from './fixture';
import { createFindings } from './findings';
import { recallAnomalies, ingestRecall } from './ingest';
import { findOutside, ingredientTerms, lookupFacts, rankByWord } from './lookup';
import {
	hasWords,
	matchNotice,
	memoryIndex,
	noticeKey,
	productWords,
	strongMatches,
	wordOverlap,
	type RecallNotice
} from './recall';
import { replayRecorded, selectReads } from './watch';

const prod = (p: Partial<Product> & { productId: string; nameFi: string }): Product => ({
	category: '10101',
	categoryGroup: '10',
	isFood: true,
	vendor: 'X OY',
	labels: [],
	temperatureClass: 'chilled',
	salesUnit: 'ST',
	baseUnit: 'ST',
	packs: [],
	lotStep: 1,
	catchWeight: false,
	allergens: { contains: [], mayContain: [], declared: false },
	freeFrom: [],
	diet: [],
	valioSubstitutes: [],
	dataQualityFlags: [],
	...p
});

// Real catalogue rows (trimmed) next to the real 9 Oct 2026 egg recall and 26 Oct pudding recall.
const catalogue = [
	prod({
		productId: '464700',
		gtin: '6430017908381',
		nameFi: 'Laitilan Kanatarha Keitetty ja kuorittu kananmuna 1,5kg suojakaasussa',
		vendor: 'MUNAX OY',
		brand: 'Laitilan Kanatarha'
	}),
	prod({
		productId: '468269',
		gtin: '6430017909647',
		nameFi: 'Munax Kokomuna vapaa 1000 g',
		vendor: 'MUNAX OY',
		brand: 'Munax'
	}),
	prod({
		productId: '474018',
		gtin: '6413300025439',
		nameFi: 'Arla Protein Vanilla rahka 500 g laktoositon',
		vendor: 'ARLA OY',
		brand: 'Arla Protein'
	}),
	prod({
		productId: '468121',
		gtin: '6430029765149',
		nameFi: 'Kieku Ulkokananmuna M10 580g',
		vendor: 'KIEKU OY',
		brand: 'Kieku'
	})
];
const idx = memoryIndex(catalogue);
const egg = recordedNotice(EGG_RECALL_URL)!;
const pudding = recordedNotice(
	'https://www.ruokavirasto.fi/elintarvikkeet/ohjeita-kuluttajille/takaisinvedot-2023-/proteiinivanukkaissa-mahdollisesti-lasinsiruja/'
)!;
const scope = { workspaceId: 'ws-demo', runId: 'run-1' };

describe('recorded notices (Context.dev extraction of real Ruokavirasto pages)', () => {
	it('the egg recall has four EAN-coded products from Munax Oy, batch 1FI15493', () => {
		expect(egg.products).toHaveLength(4);
		expect(egg.products.map((p) => p.gtin)).toContain('6415715101210');
		expect(egg.products.every((p) => p.manufacturer === 'Munax Oy' && p.batch === '1FI15493')).toBe(
			true
		);
		expect(egg.hazard).toBe('microbiological');
	});
	it('notice keys are stable across trailing slashes and case', () => {
		expect(noticeKey(egg.url)).toBe(
			noticeKey(egg.url.replace(/\/$/, '').toUpperCase().replace('HTTPS', 'https'))
		);
	});
});

describe('matching a notice against the catalogue', () => {
	it('retail eggs from Munax do not match a catalogue GTIN: supplier leads only, nothing strong', async () => {
		const ms = await matchNotice(egg, idx);
		expect(strongMatches(ms)).toEqual([]);
		const lead = ms.find((m) => m.productId === '468269')!;
		expect(lead).toMatchObject({ tier: 'supplier', confidence: 0.3 }); // brand Munax = the manufacturer
		expect(ms.find((m) => m.productId === '464700')).toMatchObject({
			tier: 'supplier',
			confidence: 0.3
		});
		expect(ms.find((m) => m.productId === '468121')).toBeUndefined(); // other producer
	});
	it('the same brand with a different product (vanukas vs rahka) stays a lead', async () => {
		const ms = await matchNotice(pudding, idx);
		expect(strongMatches(ms)).toEqual([]);
		expect(ms.find((m) => m.productId === '474018')?.tier).toBe('supplier');
	});
	it('an exact GTIN is a hit with confidence 1', async () => {
		const n: RecallNotice = { ...egg, products: [{ ...egg.products[0], gtin: '6430017908381' }] };
		const [m] = await matchNotice(n, idx);
		expect(m).toMatchObject({ productId: '464700', tier: 'gtin', confidence: 1 });
	});
	it('brand plus product words is a probable hit', async () => {
		const n: RecallNotice = {
			...egg,
			products: [
				{
					...egg.products[1],
					name: 'Laitilan Kanatarha keitetty kuorittu kananmuna 1,5 kg',
					gtin: null
				}
			]
		};
		const m = (await matchNotice(n, idx)).find((x) => x.productId === '464700')!;
		expect(m.tier).toBe('name');
		expect(m.confidence).toBeGreaterThanOrEqual(0.6);
	});
	it('company names match as whole words only', () => {
		expect(hasWords('SUOMEN SOKERI OY', 'sok')).toBe(false);
		expect(hasWords('MUNAX OY', 'munax')).toBe(true);
	});
	it('product words drop brand, sizes and filler; stems match Finnish compounds', () => {
		expect([...productWords('Arla Protein Suklaa vanukas 200g', 'Arla Protein')]).toEqual([
			'suklaa',
			'vanukas'
		]);
		expect(wordOverlap(new Set(['kananmuna']), new Set(['ulkokananmuna']))).toBe(1);
	});
});

describe('notice → anomalies', () => {
	const plan = (id: string, productIds: string[]) =>
		({ id, lines: productIds.map((productId) => ({ productId })) }) as never;

	it('no strong match: one notice-level recall anomaly, no productId, nothing held', async () => {
		const as = recallAnomalies(
			egg,
			await matchNotice(egg, idx),
			{ plans: {}, anomalies: {} },
			scope,
			'2026-11-14T10:00:00Z'
		);
		expect(as).toHaveLength(1);
		expect(as[0]).toMatchObject({
			kind: 'recall',
			id: `recall-${noticeKey(egg.url)}-notice`,
			provenance: { source: 'web', ref: egg.url }
		});
		expect(as[0].productId).toBeUndefined();
		expect(as[0].message).toMatch(/Recall 9 Oct 2026 \(Ruokavirasto\).*Nothing held/);
	});
	it('a GTIN hit on a planned product names the plan, and says the batch is not tracked', async () => {
		const n: RecallNotice = { ...egg, products: [{ ...egg.products[0], gtin: '6430017908381' }] };
		const as = recallAnomalies(
			n,
			await matchNotice(n, idx),
			{ plans: { p1: plan('p1', ['464700']), p2: plan('p2', ['1']) }, anomalies: {} },
			scope,
			'2026-11-14T10:00:00Z'
		);
		expect(as).toHaveLength(1);
		expect(as[0]).toMatchObject({ productId: '464700', planId: 'p1' });
		expect(as[0].message).toMatch(/potentially affected: orders don't record batch 1FI15493/);
	});
	it('replays say so, and known anomalies are not repeated', async () => {
		const n = { ...egg, replayOf: '2026-10-09' };
		const first = recallAnomalies(
			n,
			[],
			{ plans: {}, anomalies: {} },
			scope,
			'2026-11-14T10:00:00Z'
		);
		expect(first[0].message).toMatch(/^Replay of the 9 Oct 2026 recall/);
		const again = recallAnomalies(
			n,
			[],
			{ plans: {}, anomalies: { [first[0].id]: first[0] } },
			scope,
			'x'
		);
		expect(again).toEqual([]);
	});
});

describe('webhook auth', () => {
	const secret = 'whsec_test_0123456789abcdef';
	const body = JSON.stringify({ event: 'change.detected', id: 'evt_1' });
	const sign = (t: number, b = body, s = secret) =>
		`t=${t},v1=${createHmac('sha256', s).update(`${t}.${b}`).digest('hex')}`;
	const now = 1_794_000_000;

	it('accepts a fresh Context.dev signature', () => {
		expect(verifyContextSignature(body, sign(now), secret, now)).toBe(true);
	});
	it('rejects a tampered body, a wrong secret, a stale timestamp and a missing header', () => {
		expect(verifyContextSignature(body + ' ', sign(now), secret, now)).toBe(false);
		expect(
			verifyContextSignature(body, sign(now, body, 'other-secret-xxxxxxxx'), secret, now)
		).toBe(false);
		expect(verifyContextSignature(body, sign(now - 3600), secret, now)).toBe(false);
		expect(verifyContextSignature(body, null, secret, now)).toBe(false);
		expect(verifyContextSignature(body, sign(now), '', now)).toBe(false);
	});
	it('shared-secret header: exact match only, short secrets never open it', () => {
		expect(sameSecret(secret, secret)).toBe(true);
		expect(sameSecret(secret.slice(0, -1), secret)).toBe(false);
		expect(sameSecret('short', 'short')).toBe(false);
		expect(sameSecret(null, secret)).toBe(false);
	});
});

const chef: CallContext = {
	...scope,
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};

describe('ingest through the store (PGlite)', { timeout: 30_000 }, () => {
	it('a drill on a planned product records a recall anomaly on that plan, once, and publishes it', async () => {
		const published: ServerEvent[] = [];
		const env = await createDbPorts({ publish: (_ws, ev) => published.push(...ev) });
		const h = createHandlers(env.ports);
		const r = await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
		if (!r.ok) throw new Error(r.error.message);
		const line = r.value.plan.lines.find((l) => env.ports.catalog && l.productId)!;
		const product = (await env.ports.catalog.get([line.productId])).get(line.productId)!;
		const findings = createFindings();
		const deps = { store: env.store, index: memoryIndex([product]), findings, scope };

		const first = await replayRecorded(deps, { drillGtin: product.gtin });
		expect(first.recorded).toHaveLength(1);
		expect(first.recorded[0]).toMatchObject({
			productId: product.productId,
			planId: r.value.plan.id
		});
		const op = published.find((e) => e.kind === 'op' && e.envelope.op.type === 'RecordAnomaly');
		expect(op && op.kind === 'op' && op.envelope.via).toBe('web:replay-drill');
		const msg =
			op && op.kind === 'op' && op.envelope.op.type === 'RecordAnomaly'
				? op.envelope.op.anomaly.message
				: '';
		expect(msg).toMatch(/^Replay of the 9 Oct 2026 recall .*DRILL/);

		const again = await replayRecorded(deps, { drillGtin: product.gtin });
		expect(again.recorded).toEqual([]);
		expect(again.alreadyKnown).toBe(1);
		expect(first.findingId).toBe(`drill:ws-demo:${first.noticeKey}:${product.gtin}`);
		expect(findings.get(first.findingId)?.ops?.[0].seqs).toEqual([first.recorded[0].seq]);
		expect(findings.get(`recall:${first.noticeKey}`)).toBeUndefined(); // the real notice is unseen
	});

	it('the real egg recall ingests as one notice-level anomaly (no catalogue GTIN match)', async () => {
		const env = await createDbPorts({ runId: 'run-egg' });
		const r = await ingestRecall(egg, {
			store: env.store,
			index: idx,
			findings: createFindings(),
			scope: { ...scope, runId: 'run-egg' }
		});
		expect(r.recorded).toHaveLength(1);
		expect(r.recorded[0].productId).toBeUndefined();
	});
});

describe('watching the list', () => {
	it('picks unseen notices inside the news window, newest first, at most three', async () => {
		const list = await createFixtureRecallSource().readList();
		const picks = selectReads({
			candidates: list.flatMap((r) => (r.url ? [{ url: r.url, date: r.date }] : [])),
			pending: [],
			findings: createFindings(undefined, true),
			now: new Date('2026-11-14T10:00:00Z')
		});
		expect(picks.length).toBe(3);
		expect(picks[0]).toEqual({
			url: expect.stringMatching(/muovisessa-ensilusikassa/),
			reason: 'new'
		});
	});
});

describe('Exa lookups (recorded answers)', { timeout: 30_000 }, () => {
	it('facts for 460002 come back as GTIN-verified suggestions with quotes, and are recorded as enrichments', async () => {
		const env = await createDbPorts({ runId: 'run-facts' });
		const r = await lookupFacts(
			{ productId: '460002' },
			{
				exa: createFixtureFactSearch(),
				catalog: env.ports.catalog,
				findings: createFindings(),
				store: env.store,
				scope: { ...scope, runId: 'run-facts' }
			}
		);
		expect(r.catalogue.allergens).toBeNull(); // Valio has no allergen record for it
		const ing = r.suggestions.find((s) => s.field === 'ingredients')!;
		expect(ing.gtinCited).toBe(true);
		expect(ing.sources[0].gtinCited).toBe(true);
		expect(ing.sources[0].url).toContain('6416796729140');
		expect(ing.sources[0].quote).toMatch(/Ainesosat/);
		expect(r.recorded.length).toBe(r.suggestions.length);
	});
	it('joulutorttu: sourced options with ingredients mapped to catalogue products', async () => {
		const env = await createDbPorts({ runId: 'run-outside' });
		const r = await findOutside('joulutorttu', {
			exa: createFixtureFactSearch(),
			catalog: env.ports.catalog,
			findings: createFindings()
		});
		expect(r.options.length).toBeGreaterThan(0);
		expect(r.options[0].sources[0].url).toMatch(/^https:\/\//);
		expect(r.options.flatMap((o) => o.ingredients).some((i) => i.catalogue.length > 0)).toBe(true);
	});
	it('catalogue hits rank by where the word starts in the name', () => {
		const ranked = rankByWord(
			[
				prod({
					productId: '461412',
					nameFi: 'Barilla 6 kg Tagliatelle pasta, sisältää kananmunaa'
				}),
				prod({ productId: '463883', nameFi: 'Kieku Luomu kananmuna M90 5200g' }),
				prod({ productId: '463740', nameFi: 'Atria Kanan Koipi Naturel 4x800g' })
			],
			ingredientTerms('2 kananmunaa')
		);
		expect(ranked[0].productId).toBe('463883');
	});
	it('ingredient terms strip quantities and inflection', () => {
		expect(ingredientTerms('1 kg lehtitaikinalevyjä (10 kpl)')).toEqual([
			'lehtitaikinalevyjä',
			'lehtitaikinale',
			'lehtitaikin',
			'lehtitaik'
		]);
		expect(ingredientTerms('2 dl vispi- tai kuohukermaa')[0]).toBe('kuohukermaa');
	});
});
