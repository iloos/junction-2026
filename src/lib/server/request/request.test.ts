import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { convert, contentPerSalesUnit } from './convert';
import { findDate } from './dates';
import { parseRequest, parseRules } from './parse';
import { approvalView, callTool, runRequest } from './run';

const TODAY = '2026-11-14'; // Saturday, the demo clock

function product(p: Partial<Product> & { productId: string; nameFi: string }): Product {
	return {
		category: '10400',
		categoryGroup: '10',
		isFood: true,
		vendor: 'v',
		labels: [],
		temperatureClass: 'chilled',
		salesUnit: 'ST',
		baseUnit: 'ST',
		packs: [],
		lotStep: 0.01,
		catchWeight: false,
		allergens: { contains: [], mayContain: [], declared: true },
		freeFrom: [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: [],
		...p
	};
}

describe('dates', () => {
	it('resolves weekdays and relative words against the sim date', () => {
		expect(findDate('1,000 L milk by Monday', TODAY)?.iso).toBe('2026-11-16');
		expect(findDate('200 kg potatoes Friday', TODAY)?.iso).toBe('2026-11-20');
		expect(findDate('2 cases of butter tomorrow', TODAY)?.iso).toBe('2026-11-15');
		expect(findDate('1000 l laktoositonta maitoa maanantaiksi', TODAY)?.iso).toBe('2026-11-16');
		expect(findDate('perunaa 16.11.', TODAY)?.iso).toBe('2026-11-16');
		expect(findDate('milk', TODAY)).toBeNull();
	});
	it('says so when the weekday is today', () => {
		const d = findDate('milk by Saturday', TODAY)!;
		expect(d.iso).toBe('2026-11-21');
		expect(d.note).toMatch(/today is Saturday/);
	});
});

describe('rule parser', () => {
	it("parses Valio's example", () => {
		const r = parseRules('1,000 L lactose-free milk by Monday', TODAY);
		expect(r.deliverBy).toBe('2026-11-16');
		expect(r.items).toHaveLength(1);
		const [i] = r.items;
		expect(i).toMatchObject({
			qty: 1000,
			unit: 'l',
			product: 'milk',
			constraints: ['lactose_free']
		});
		expect(i.search[0]).toBe('maito laktoositon');
		expect(i.ambiguities).toEqual([]);
		expect(r.ambiguities).toEqual([]);
	});
	it('parses the Finnish form', () => {
		const r = parseRules('1000 l laktoositonta maitoa maanantaiksi', TODAY);
		expect(r.deliverBy).toBe('2026-11-16');
		expect(r.items[0]).toMatchObject({
			qty: 1000,
			unit: 'l',
			product: 'milk',
			constraints: ['lactose_free']
		});
	});
	it('parses kilos and cases', () => {
		const p = parseRules('200 kg potatoes Friday', TODAY);
		expect(p.items[0]).toMatchObject({ qty: 200, unit: 'kg', product: 'potatoes' });
		const b = parseRules('2 cases of butter tomorrow', TODAY);
		expect(b.items[0]).toMatchObject({ qty: 2, unit: 'case', product: 'butter' });
		expect(b.deliverBy).toBe('2026-11-15');
		expect(b.notes.join()).toMatch(/Sunday/);
	});
	it('splits several items and converts dl/g', () => {
		const r = parseRules('1,000 L lactose-free milk, 500 g butter and 5 dl cream by Monday', TODAY);
		expect(r.items.map((i) => [i.product, i.qty, i.unit])).toEqual([
			['milk', 1000, 'l'],
			['butter', 0.5, 'kg'],
			['cream', 0.5, 'l']
		]);
	});
	it('shows ambiguity instead of guessing', () => {
		const r = parseRules('lactose-free milk', TODAY);
		expect(r.items[0].qty).toBeNull();
		expect(r.items[0].ambiguities.join()).toMatch(/how much/);
		expect(r.ambiguities.join()).toMatch(/no delivery date/);
		const u = parseRules('40 milk by Monday', TODAY);
		expect(u.items[0].unit).toBe('sales');
		expect(u.items[0].ambiguities.join()).toMatch(/no unit/);
		const x = parseRules('10 kg quinoa by Friday', TODAY);
		expect(x.items[0].product).toBeNull();
		expect(x.items[0].search[0]).toBe('quinoa');
		expect(x.items[0].ambiguities.join()).toMatch(/not in my word list/);
	});
	it('flags a comma that could be Finnish decimal', () => {
		const r = parseRules('1,500 kg perunaa perjantaiksi', TODAY);
		expect(r.items[0].qty).toBe(1500);
		expect(r.items[0].ambiguities.join()).toMatch(/comma/);
	});
});

describe('model parser', () => {
	const llm = (text: string): Llm => ({
		generate: async () => ({
			text,
			model: 'gemini-test',
			tokens: { in: 10, out: 20 },
			latencyMs: 5
		})
	});
	it('uses the model output and still resolves the date by the clock', async () => {
		const r = await parseRequest('1,000 L lactose-free milk by Monday', {
			today: TODAY,
			llmKind: 'gemini',
			llm: llm(
				JSON.stringify({
					items: [
						{
							query: 'lactose-free milk',
							qty: 1000,
							unit: 'l',
							constraints: ['lactose_free'],
							searchFi: ['maito', 'laktoositon']
						}
					],
					deliverBy: '2026-11-16',
					ambiguities: []
				})
			)
		});
		expect(r.parser.kind).toBe('gemini');
		expect(r.items[0]).toMatchObject({ product: 'milk', qty: 1000, unit: 'l' });
		expect(r.deliverBy).toBe('2026-11-16');
		expect(r.ambiguities).toEqual([]);
	});
	it('falls back to the rules on bad JSON, and says so', async () => {
		const r = await parseRequest('200 kg potatoes Friday', {
			today: TODAY,
			llmKind: 'gemini',
			llm: llm('not json')
		});
		expect(r.parser.kind).toBe('rules');
		expect(r.parser.fallback).toMatch(/model call failed/);
		expect(r.items[0].qty).toBe(200);
	});
	it('shows a disagreement with the rules', async () => {
		const r = await parseRequest('1,000 L lactose-free milk by Monday', {
			today: TODAY,
			llmKind: 'gemini',
			llm: llm(
				JSON.stringify({
					items: [{ query: 'milk', qty: 100, unit: 'l', constraints: [], searchFi: ['maito'] }],
					deliverBy: null
				})
			)
		});
		expect(r.items[0].ambiguities.join()).toMatch(/the model read 100 l, the rules 1000 l/);
	});
});

describe('unit conversion', () => {
	const milk = product({
		productId: '464201',
		nameFi: 'Valio kevytmaito 1 l laktoositon UHT',
		packs: [
			{ unit: 'PAL', baseUnits: 600 },
			{ unit: 'KI', baseUnits: 10 },
			{ unit: 'ST', baseUnits: 1 }
		],
		netPerSalesUnit: { value: { value: 1.031, unit: 'kg' }, provenance: { source: 'valio_static' } }
	});
	it('1,000 l of a 1 l ST product = 1,000 ST (= 100 KI)', () => {
		const c = convert(1000, 'l', milk);
		expect(c).toMatchObject({ ok: true, salesQty: 1000, salesUnit: 'ST', exact: true });
		expect(c.ok && c.explain).toBe('1,000 l ÷ 1 l per ST = 1,000 ST (= 100 KI)');
	});
	it('1,000 l sold by the KI case of 10 × 1 l = 100 KI', () => {
		const ki = product({
			productId: '464119',
			nameFi: 'Valio rasvaton maito 1 l laktoositon UHT',
			salesUnit: 'KI',
			packs: [
				{ unit: 'KI', baseUnits: 10 },
				{ unit: 'ST', baseUnits: 1 }
			]
		});
		expect(convert(1000, 'l', ki)).toMatchObject({
			ok: true,
			salesQty: 100,
			salesUnit: 'KI',
			exact: true
		});
	});
	it('rounds up and says so', () => {
		const half = product({
			productId: '464440',
			nameFi: 'Valio kevytmaito 0,5 l laktoositon UHT',
			packs: [{ unit: 'KI', baseUnits: 10 }]
		});
		const c = convert(1000.2, 'l', half);
		expect(c).toMatchObject({ ok: true, salesQty: 2001, exact: false });
		expect(c.ok && c.explain).toMatch(/rounded up from 2,000.4/);
	});
	it('refuses when the name and Valio net weight disagree', () => {
		const butter = product({
			productId: '464205',
			nameFi: 'Valio voi 4x5 kg suolaamaton',
			salesUnit: 'KI',
			packs: [{ unit: 'KI', baseUnits: 4 }],
			netPerSalesUnit: { value: { value: 80, unit: 'kg' }, provenance: { source: 'valio_static' } }
		});
		const c = convert(40, 'kg', butter);
		expect(c.ok).toBe(false);
		expect(!c.ok && c.reason).toMatch(/net weight says 80 kg/);
	});
	it('reads "4x5 kg" with a KI of 4 as a 5 kg unit, even when Valio net weight is the case', () => {
		const p = product({
			productId: '464076',
			nameFi: 'Valio Eila® voi 4x5 kg laktoositon',
			packs: [{ unit: 'KI', baseUnits: 4 }],
			netPerSalesUnit: { value: { value: 20, unit: 'kg' }, provenance: { source: 'valio_static' } }
		});
		const c = contentPerSalesUnit(p, 'kg');
		expect(c).toMatchObject({ value: 5, source: 'name' });
		expect('text' in c && c.text).toContain('net weight (20 kg) is the whole case');
	});
	it('cases convert through the pack hierarchy', () => {
		const p = product({
			productId: '475797',
			nameFi: 'Valio voi 500 g normaalisuolainen',
			packs: [{ unit: 'KI', baseUnits: 20 }]
		});
		expect(convert(2, 'case', p)).toMatchObject({ ok: true, salesQty: 40, salesUnit: 'ST' });
		expect(convert(2, 'case', product({ productId: '1', nameFi: 'x' })).ok).toBe(false);
	});
	it('kg sold per kg is exact', () => {
		const p = product({
			productId: '460078',
			nameFi: 'PP PUIKULA PERUNA PESTY',
			salesUnit: 'KG',
			baseUnit: 'KG'
		});
		expect(convert(200, 'kg', p)).toMatchObject({
			ok: true,
			salesQty: 200,
			salesUnit: 'KG',
			exact: true
		});
	});
	it('asks when nothing states the content', () => {
		const p = product({
			productId: '2',
			nameFi: 'Valio rasvaton maito laktoositon',
			salesUnit: 'KI',
			packs: [{ unit: 'KI', baseUnits: 10 }]
		});
		const c = convert(100, 'l', p);
		expect(!c.ok && c.reason).toMatch(/give the quantity in KI/);
	});
});

describe('request flow on the PGlite fixture', () => {
	it('milk example → 1,000 ST of 464201, sign-off over line and order caps; approve, commit, retry = same receipt', async () => {
		const env = await createDbPorts({ now: `${TODAY}T12:00:00+02:00` });
		env.overlay.clear();
		const quoted: string[][] = [];
		const offers = env.ports.catalog.offers.bind(env.ports.catalog);
		env.ports.catalog = {
			...env.ports.catalog,
			offers: async (ids, d) => (quoted.push(ids), offers(ids, d))
		};
		const h = createHandlers(env.ports);
		const ctx = (kind: keyof typeof SCOPES_BY_ACTOR, id: string): CallContext => ({
			workspaceId: env.workspaceId,
			runId: env.runId,
			actor: { kind, id },
			scopes: SCOPES_BY_ACTOR[kind],
			via: 'test'
		});
		const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		const events: string[] = [];

		const r = await runRequest('1,000 L lactose-free milk by Monday', {
			handlers: h,
			ctx: ctx('kitchen_agent', 'request-agent'),
			today: TODAY,
			kitchen,
			nonce: 't1',
			onEvent: (e) => events.push(`${e.step}:${e.status}`)
		});
		expect(events).toEqual(['request:done', 'lookup:done', 'order:warn']);
		const item = r.lookup!.items[0];
		expect(item.pick?.productId).toBe('464201');
		expect(item.pick?.conversion).toMatchObject({
			ok: true,
			salesQty: 1000,
			explain: '1,000 l ÷ 1 l per ST = 1,000 ST (= 100 KI)'
		});
		// Only the shortlist (≤5) and Valio's rule target were quoted, in one call.
		expect(quoted[0].length).toBeLessThanOrEqual(6);
		expect(r.lookup!.quotedIds).toContain('464440');
		// Valio's rule 464201 → 464440 is shown as skipped, and 464440 is never pickable.
		expect(item.valioRules).toEqual([
			expect.objectContaining({ from: '464201', to: '464440', status: 'skipped' })
		]);
		const alt = item.shortlist.find((c) => c.productId === '464440');
		if (alt) expect(alt.skipped).toBeTruthy();

		const plan = r.order!.plan;
		expect(plan.lines).toHaveLength(1);
		expect(plan.lines[0]).toMatchObject({
			productId: '464201',
			qty: { value: 1000, unit: 'ST' },
			state: 'held',
			tier: 'sign_off',
			lineCents: 156000
		});
		expect(plan.lines[0].reasons).toEqual(
			expect.arrayContaining(['CAP_EXCEEDED.line', 'CAP_EXCEEDED.order'])
		);
		const ap = r.order!.approval!;
		expect(ap).toMatchObject({
			state: 'pending',
			tier: 'sign_off',
			planVersion: plan.version,
			termsHash: plan.termsHash,
			totalCents: 156000,
			mandateVersion: kitchen.mandate.version,
			requestedBy: 'the kitchen agent',
			decidedBy: null
		});
		expect(Date.parse(ap.expiresAt ?? '')).not.toBeNaN();

		// Same words, same nonce → the same plan (idempotent), not a second order.
		const again = await runRequest('1,000 L lactose-free milk by Monday', {
			handlers: h,
			ctx: ctx('kitchen_agent', 'request-agent'),
			today: TODAY,
			kitchen,
			nonce: 't1'
		});
		expect(again.order!.plan.id).toBe(plan.id);

		const approver = ctx('approver', 'head-chef');
		await callTool(h, approver, 'approve', {
			approvalId: ap.id,
			planVersion: ap.planVersion,
			termsHash: ap.termsHash,
			decision: 'grant'
		});
		const chef = ctx('chef', 'chef');
		const v = await approvalView(h, chef, plan.id);
		expect(v.approval?.state).toBe('granted');
		const c1 = await callTool(h, chef, 'commit_order', {
			planId: plan.id,
			version: v.plan.version,
			idempotencyKey: 'k1'
		});
		const c2 = await callTool(h, chef, 'commit_order', {
			planId: plan.id,
			version: v.plan.version,
			idempotencyKey: 'k1'
		});
		expect(c1.totalCents).toBe(156000);
		expect(c2.receiptId).toBe(c1.receiptId);
	}, 60_000);

	it('asks instead of ordering when the quantity is missing, and quotes nothing', async () => {
		const env = await createDbPorts({ now: `${TODAY}T12:00:00+02:00` });
		const quoted: string[][] = [];
		const offers = env.ports.catalog.offers.bind(env.ports.catalog);
		env.ports.catalog = {
			...env.ports.catalog,
			offers: async (ids, d) => (quoted.push(ids), offers(ids, d))
		};
		const h = createHandlers(env.ports);
		const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
		const r = await runRequest('lactose-free milk by Monday', {
			handlers: h,
			ctx: {
				workspaceId: env.workspaceId,
				runId: env.runId,
				actor: { kind: 'kitchen_agent', id: 'a' },
				scopes: SCOPES_BY_ACTOR.kitchen_agent,
				via: 'test'
			},
			today: TODAY,
			kitchen
		});
		expect(r.order).toBeNull();
		expect(r.lookup!.items[0].question).toMatch(/How much/);
		expect(quoted).toEqual([]);
	}, 60_000);
});
