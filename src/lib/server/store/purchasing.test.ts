/**
 * Purchasing transitions the adversarial review (round 9) reproduced, each flipped: hard requirements reach the need
 * and bind substitutes and commit (R7-01); a substitute supersedes the original's purchase (R7-02); an amount edit
 * changes the need in its own dimension (R9-03); the kitchen's receiving days hold at the gate (R9-06).
 */
import { describe, expect, it } from 'vitest';
import { Kitchen, Product, SCOPES_BY_ACTOR, type ActorKind } from '$lib/core/contracts';
import type { Catalog, CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { runRequest } from '$lib/server/request/run';
import { createDbPorts } from './db-ports';

const ctx = (kind: ActorKind = 'kitchen_agent'): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-test` },
	scopes: SCOPES_BY_ACTOR[kind as keyof typeof SCOPES_BY_ACTOR],
	via: 'test'
});
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const prov = { source: 'team_estimate' as const, note: 'synthetic fixture' };
const milk = (productId: string, nameFi: string, lactoseFree: boolean) =>
	Product.parse({
		productId,
		nameFi,
		category: '10400',
		categoryGroup: '10',
		isFood: true,
		vendor: 'Test',
		origin: 'fi',
		labels: [],
		temperatureClass: 'chilled',
		salesUnit: 'ST',
		baseUnit: 'ST',
		packs: [{ unit: 'ST', baseUnits: 1 }],
		lotStep: 1,
		catchWeight: false,
		netPerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: prov },
		reliability: 1,
		allergens: { contains: ['MILK'], mayContain: [], declared: true },
		freeFrom: lactoseFree ? ['LACTOSE'] : [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: []
	});

async function harness(o: { deliveryDays?: Kitchen['deliveryDays'] } = {}) {
	const products = new Map([
		['464201', milk('464201', 'Testi kevytmaito laktoositon 1 l', true)],
		['470418', milk('470418', 'Testi kevytmaito 1 l', false)],
		['470420', milk('470420', 'Testi rasvaton maito 1 l', true)]
	]);
	const kitchen = Kitchen.parse({
		id: 'k-hotel',
		profile: 'test',
		name: 'Test kitchen',
		kind: 'hotel',
		city: 'Espoo',
		size: {},
		deliveryDays: o.deliveryDays ?? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
		weights: { price: 1 },
		constraints: {
			origin: [],
			allergens: { freeFrom: [], unknownCounts: 'reject' },
			tenderListOnly: false,
			labels: []
		},
		mandate: {
			version: 1,
			words: 'test',
			lineCapCents: 100000,
			orderCapCents: 100000,
			weeklyCapCents: 500000,
			hardLimitCents: 1000000,
			neverDelegate: []
		},
		factorSensitivity: {},
		usualProducts: [...products.keys()]
	});
	let candidates = ['470418'];
	const catalog: Catalog = {
		get: async (ids) =>
			new Map(ids.filter((id) => products.has(id)).map((id) => [id, products.get(id)!])),
		search: async () => [...products.values()],
		candidates: async () => candidates.map((productId) => ({ productId, fromValioRule: true })),
		offers: async (ids, deliverBy) => ({
			notFound: [],
			offers: ids.map((productId) => ({
				productId,
				price: {
					unitCents: productId === '470418' ? 90 : 100,
					comparison: null,
					taxRate: 13.5,
					validTo: null,
					provenance: prov
				},
				availability: {
					kind: 'known' as const,
					amount: 100,
					logisticModel: 'Stock',
					availableDate: deliverBy,
					closingTime: `${deliverBy}T15:00:00+02:00`,
					raw: 100,
					provenance: prov
				}
			}))
		})
	};
	const b = await createDbPorts({ catalog, kitchens: [kitchen], now: '2026-12-07T10:00:00+02:00' });
	const h = createHandlers(b.ports);
	return {
		b,
		h,
		kitchen,
		setCandidates: (ids: string[]) => (candidates = ids),
		state: () => b.ports.store.load('ws-demo', 'run-1')
	};
}

const lactoseFree = (
	h: Awaited<ReturnType<typeof harness>>['h'],
	key: string,
	deliverBy = '2026-12-10'
) =>
	h.place_order(ctx(), {
		kitchenId: 'k-hotel',
		deliverBy,
		idempotencyKey: key,
		lines: [
			{
				productId: '464201',
				qty: 10,
				unit: 'ST',
				amount: { value: 10, unit: 'l' },
				requirements: { freeFrom: ['LACTOSE'] }
			}
		]
	});

describe('R7-01: hard requirements reach the need and bind substitutes and commit', () => {
	it('a lactose-free need never ranks or buys ordinary milk', async () => {
		const { h, setCandidates } = await harness();
		const p = must(await lactoseFree(h, 'lf')).plan;
		expect(p.needs[0].requirements).toEqual({ freeFrom: ['LACTOSE'] });
		const sub = must(
			await h.find_substitutes(ctx(), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		expect(sub.chosen).toEqual([]);
		expect(sub.candidates.find((c) => c.productId === '470418')?.rejectedReasons).toContain(
			'requirement_unmet'
		);
		// A lactose-free candidate is still found.
		setCandidates(['470418', '470420']);
		const ok = must(
			await h.find_substitutes(ctx(), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		expect(ok.chosen.map((l) => l.productId)).toEqual(['470420']);
	});

	it('the gate refuses a line that breaks its need, whatever edited it in', async () => {
		const { h } = await harness();
		const p = must(await lactoseFree(h, 'swap')).plan;
		const swapped = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				patch: { productId: '470418' }
			})
		).plan;
		expect(swapped.lines[0]).toMatchObject({ state: 'unorderable' });
		expect(swapped.lines[0].reasons).toContain('requirement_unmet');
		const c = await h.commit_order(ctx('chef'), {
			planId: p.id,
			version: swapped.version,
			idempotencyKey: 'swap-commit',
			lineIds: [swapped.lines[0].id]
		});
		expect(c.ok ? c.value.committedLineIds : []).toEqual([]);
	});

	it('a /request for lactose-free milk carries the requirement into the plan', async () => {
		const { h, kitchen } = await harness();
		const r = await runRequest('10 litres of lactose-free milk for December 10', {
			handlers: h,
			ctx: ctx(),
			kitchen,
			today: '2026-12-07',
			llm: null,
			llmKind: 'fixture',
			nonce: 'lf-request'
		} as unknown as Parameters<typeof runRequest>[1]);
		expect(r.order?.plan.needs[0].requirements).toEqual({ freeFrom: ['LACTOSE'] });
	});
});

describe('R9-06: the receiving calendar holds at the gate', () => {
	it('a Monday-only kitchen cannot have the agent commit a Thursday delivery', async () => {
		const { h, state } = await harness({ deliveryDays: ['mon'] });
		const p = must(await lactoseFree(h, 'thu', '2026-12-10')).plan;
		expect(p.lines[0]).toMatchObject({ state: 'held', tier: 'sign_off' });
		expect(p.lines[0].reasons).toContain('off_delivery_day');
		const c = await h.commit_order(ctx(), {
			planId: p.id,
			version: p.version,
			idempotencyKey: 'thu-c'
		});
		expect(c.ok ? c.value.committedLineIds : c.error.code).toBe('FORBIDDEN');
		expect(Object.keys((await state()).orders)).toEqual([]);
	});

	it('a receiving day is not held', async () => {
		const { h } = await harness({ deliveryDays: ['mon'] });
		const p = must(await lactoseFree(h, 'mon', '2026-12-14')).plan;
		expect(p.lines[0].reasons).not.toContain('off_delivery_day');
	});
});

describe('R7-02: a substitute replaces the purchase, it is not bought beside it', () => {
	it('one 10 l need buys 10 l: the original goes to 0, superseded, in the same change', async () => {
		const { h } = await harness();
		const p = must(
			await h.place_order(ctx(), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'replace',
				lines: [{ productId: '464201', qty: 10, unit: 'ST', amount: { value: 10, unit: 'l' } }]
			})
		).plan;
		const r = must(
			await h.find_substitutes(ctx(), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		const original = r.plan.lines.find((l) => l.id === p.lines[0].id)!;
		expect(original.qty.value).toBe(0);
		expect(original.reasons).toContain('superseded');
		const bought = must(
			await h.commit_order(ctx(), {
				planId: p.id,
				version: r.plan.version,
				idempotencyKey: 'replace-commit'
			})
		);
		expect(bought.committedLineIds).toEqual([r.chosen[0].id]);
		const f = must(await h.get_plan(ctx(), { planId: p.id })).plan.view!.fulfilment[0];
		expect(f.excess.value).toBe(0);
	});
});
