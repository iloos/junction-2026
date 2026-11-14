/**
 * Purchasing transitions the adversarial review (round 9) reproduced, each flipped: hard requirements reach the need
 * and bind substitutes and commit (R7-01); a substitute supersedes the original's purchase (R7-02); an amount edit
 * changes the need in its own dimension (R9-03); the kitchen's receiving days hold at the gate (R9-06).
 */
import { describe, expect, it } from 'vitest';
import { Kitchen, Product, SCOPES_BY_ACTOR, type ActorKind } from '$lib/core/contracts';
import type { Catalog, CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { factsFor } from '$lib/core/services/views';
import { planFulfilment } from '$lib/core/mandate/fulfilment';
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

async function harness(
	o: { deliveryDays?: Kitchen['deliveryDays']; origin?: Kitchen['constraints']['origin'] } = {}
) {
	const products = new Map([
		// Two Swedish lactose-free milks: nothing Finnish and lactose-free exists in this catalogue.
		[
			'470499',
			Product.parse({ ...milk('470499', 'Testi svensk mjölk laktoositon 1 l', true), origin: 'se' })
		],
		[
			'470500',
			Product.parse({
				...milk('470500', 'Testi svensk lättmjölk laktoositon 1 l', true),
				origin: 'se'
			})
		],
		['464201', milk('464201', 'Testi kevytmaito laktoositon 1 l', true)],
		['470418', milk('470418', 'Testi kevytmaito 1 l', false)],
		['470420', milk('470420', 'Testi rasvaton maito 1 l', true)],
		// Valio states both weight and content volume for this pack: its own density, 1.031 kg/l.
		[
			'464299',
			Product.parse({
				...milk('464299', 'Testi täysmaito 1 l', false),
				netPerSalesUnit: { value: { value: 1.031, unit: 'kg' }, provenance: prov },
				netVolumePerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: prov }
			})
		]
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
			origin: o.origin ?? [],
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
	let supply: 'known' | 'unknown' = 'known';
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
					kind: supply,
					amount: supply === 'known' ? 100 : null,
					logisticModel: supply === 'known' ? 'Stock' : 'Terminal',
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
		setSupply: (k: 'known' | 'unknown') => (supply = k),
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
		// The need says why nothing qualified; a lactose-free candidate is still found, and the note goes.
		expect(sub.plan.needs[0].unresolved).toBe('no product meets free from LACTOSE');
		setCandidates(['470418', '470420']);
		const ok = must(
			await h.find_substitutes(ctx(), {
				planId: p.id,
				version: sub.plan.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		expect(ok.chosen.map((l) => l.productId)).toEqual(['470420']);
		expect(ok.plan.needs[0].unresolved).toBeUndefined();
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

describe('R9-03: an amount edit changes the need, in its own dimension', () => {
	const fourLitres = async (h: Awaited<ReturnType<typeof harness>>['h']) =>
		must(
			await h.place_order(ctx(), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'four',
				lines: [{ productId: '464201', qty: 4, unit: 'ST', amount: { value: 4, unit: 'l' } }]
			})
		).plan;

	it('"make it 20 kg" on a 4 l need is refused with the unit to use', async () => {
		const { h } = await harness();
		const p = await fourLitres(h);
		const r = await h.edit_line(ctx('chef'), {
			planId: p.id,
			version: p.version,
			needId: p.needs[0].id,
			patch: { amount: { value: 20, unit: 'kg' } }
		});
		// This pack states no volume beside its weight: a question for the unit, never a water guess.
		expect(r.ok ? null : r.error).toMatchObject({
			code: 'INVALID_INPUT',
			detail: { needUnit: 'l', given: 'kg', why: 'no_density' }
		});
	});

	it("with the pack's own weight and volume, the refusal offers the converted amount to confirm", async () => {
		const { h } = await harness();
		const p = must(
			await h.place_order(ctx(), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'dense',
				lines: [{ productId: '464299', qty: 4, unit: 'ST', amount: { value: 4, unit: 'kg' } }]
			})
		).plan;
		const r = await h.edit_line(ctx('chef'), {
			planId: p.id,
			version: p.version,
			needId: p.needs[0].id,
			patch: { amount: { value: 20, unit: 'l' } }
		});
		expect(r.ok ? null : r.error).toMatchObject({
			code: 'INVALID_INPUT',
			detail: { needUnit: 'kg', given: 'l', converted: { value: 20.62, unit: 'kg' } }
		});
		expect(r.ok ? '' : r.error.message).toContain('Confirm 20.62 kg?');
		// Nothing changed until the chef confirms.
		const now = must(await h.get_plan(ctx('chef'), { planId: p.id })).plan;
		expect(now.version).toBe(p.version);
	});

	it('4 l → 20 l moves the need and the purchase together', async () => {
		const { h } = await harness();
		const p = await fourLitres(h);
		const r = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: p.version,
				needId: p.needs[0].id,
				patch: { amount: { value: 20, unit: 'l' } }
			})
		).plan;
		expect(r.needs[0].amount).toMatchObject({ value: 20, unit: 'l' });
		expect(r.lines[0].qty).toMatchObject({ value: 20, unit: 'ST' });
		const f = r.view!.fulfilment[0];
		expect(f.required.value).toBe(20);
		expect(f.excess.value).toBe(0);
	});

	it('0 means nothing to buy, not one sales unit', async () => {
		const { h } = await harness();
		const p = await fourLitres(h);
		const r = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: p.version,
				needId: p.needs[0].id,
				patch: { amount: { value: 0, unit: 'l' } }
			})
		).plan;
		expect(r.lines[0].qty.value).toBe(0);
	});
});

describe('R7-04: a dish edit carries its dependency closure', () => {
	it('doubling the rice porridge doubles its milk too', async () => {
		const b = await createDbPorts();
		b.overlay.clear();
		const h = createHandlers(b.ports);
		const p = must(
			await h.plan_event(ctx('chef'), { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		).plan;
		const rice = p.needs.find((n) => /rice porridge.*rice/i.test(n.label))!;
		const milkNeed = p.needs.find((n) => /rice porridge.*milk/i.test(n.label))!;
		const milkLine = p.lines.find((l) => l.needId === milkNeed.id)!;
		const r = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: p.version,
				needId: rice.id,
				patch: { gramsPerGuest: 2 * rice.dish!.gServed }
			})
		).plan;
		const next = (id: string) => r.needs.find((n) => n.id === id)!;
		expect(next(rice.id).amount.value).toBeCloseTo(2 * rice.amount.value);
		expect(next(milkNeed.id).amount.value).toBeCloseTo(2 * milkNeed.amount.value);
		expect(r.lines.find((l) => l.needId === milkNeed.id)!.qty.value).toBeGreaterThan(
			milkLine.qty.value
		);
	});
});

describe('R7-11: a receipt confirms what it says', () => {
	it('1 of 10 units confirmed is 1 confirmed and 9 still awaited', async () => {
		const { h, b, state } = await harness();
		const p = must(
			await h.place_order(ctx(), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'receipt',
				lines: [{ productId: '464201', qty: 10, unit: 'ST', amount: { value: 10, unit: 'l' } }]
			})
		).plan;
		must(await h.commit_order(ctx(), { planId: p.id, version: p.version, idempotencyKey: 'r-c' }));
		const s = structuredClone(await state());
		Object.values(s.receipts)[0].confirmed[0].qty.value = 1;
		const plan = must(await h.get_plan(ctx(), { planId: p.id })).plan;
		const products = await b.ports.catalog.get(['464201']);
		const [f] = planFulfilment(plan, factsFor(plan, products, undefined, s));
		expect(f.supplierConfirmed.value).toBe(1);
		expect(f.awaitingSupplier.value).toBe(9);
	});
});

describe('R7-03: supply that turns unknown after an approval asks again', () => {
	it('a grant on known stock does not buy a line whose supply is now unknown', async () => {
		const { h, setSupply } = await harness();
		const p = must(
			await h.place_order(ctx('external_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'drift',
				lines: [{ productId: '464201', qty: 10, unit: 'ST', amount: { value: 10, unit: 'l' } }]
			})
		).plan;
		const a = must(await h.get_plan(ctx('chef'), { planId: p.id })).approval!;
		must(
			await h.approve(ctx('chef'), {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			})
		);
		setSupply('unknown');
		const c = await h.commit_order(ctx('external_agent'), {
			planId: p.id,
			version: p.version,
			idempotencyKey: 'drift-c'
		});
		expect(c.ok ? 'committed' : c.error.code).toBe('TERMS_CHANGED');
		const now = must(await h.get_plan(ctx('chef'), { planId: p.id }));
		expect(now.plan.lines[0].offer?.availability.kind).toBe('unknown');
		expect(now.approval?.state ?? 'none').not.toBe('granted');
	});
});

describe('order-scope strict requirements, best try and fallback', () => {
	const swedish = (
		h: Awaited<ReturnType<typeof harness>>['h'],
		key: string,
		who: ActorKind = 'chef'
	) =>
		h.place_order(ctx(who), {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-10',
			idempotencyKey: key,
			requirements: { origin: 'fi' },
			lines: [
				{
					productId: '470499',
					qty: 10,
					unit: 'ST',
					amount: { value: 10, unit: 'l' },
					requirements: { freeFrom: ['LACTOSE'] }
				}
			]
		});

	it("the order requirement binds every line, beside the line's own (they only add up)", async () => {
		const { h } = await harness();
		const p = must(await swedish(h, 'scope')).plan;
		expect(p.requirements).toEqual({ origin: 'fi' });
		expect(p.lines[0].state).toBe('unorderable');
		expect(p.lines[0].reasons).toContain('requirement_unmet');
	});

	it('two origins at once: nothing qualifies', async () => {
		const { h } = await harness();
		const p = must(
			await h.place_order(ctx('chef'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'conflict',
				requirements: { origin: 'fi' },
				lines: [
					{
						productId: '470499',
						qty: 2,
						unit: 'ST',
						amount: { value: 2, unit: 'l' },
						requirements: { origin: 'se' }
					}
				]
			})
		).plan;
		expect(p.lines[0].reasons).toContain('requirement_unmet');
	});

	it('nothing meets every rule: the need says so, and the nearest product breaking only origin is a best try', async () => {
		const { h, setCandidates } = await harness();
		setCandidates(['470500', '470418']);
		const p = must(await swedish(h, 'besttry')).plan;
		const r = must(
			await h.find_substitutes(ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		expect(r.chosen).toEqual([]);
		expect(r.plan.needs[0].unresolved).toBe('no product meets free from LACTOSE, origin FI');
		const sw = r.candidates.find((c) => c.productId === '470500')!;
		expect(sw.bestTry).toEqual({ relaxes: 'origin' });
		// Allergens never relax: Finnish milk with lactose is no best try.
		expect(r.candidates.find((c) => c.productId === '470418')?.bestTry).toBeUndefined();
	});

	it('a person accepts the best try: held for sign-off, the relaxed rule in the terms; an agent may not', async () => {
		const { h } = await harness();
		const p = must(await swedish(h, 'accept')).plan;
		const agent = await h.edit_line(ctx('kitchen_agent'), {
			planId: p.id,
			version: p.version,
			lineId: p.lines[0].id,
			patch: { productId: '470500', relax: 'origin' }
		});
		expect(agent.ok ? null : agent.error).toMatchObject({ code: 'FORBIDDEN' });
		const ok = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				patch: { productId: '470500', relax: 'origin' }
			})
		).plan;
		expect(ok.lines[0]).toMatchObject({ state: 'held', tier: 'sign_off', productId: '470500' });
		expect(ok.lines[0].reasons).toContain('requirement_relaxed.origin');
		expect(ok.lines[0].reasons).not.toContain('requirement_unmet');
		// Relaxing origin never lets lactose in.
		const lactose = must(
			await h.edit_line(ctx('chef'), {
				planId: p.id,
				version: ok.version,
				lineId: p.lines[0].id,
				patch: { productId: '470418', relax: 'origin' }
			})
		).plan;
		expect(lactose.lines[0].reasons).toContain('requirement_unmet');
	});

	it('a preferred origin the pick lacks is said in words', async () => {
		const { h, setCandidates } = await harness({
			origin: [{ categoryGroup: '10', rule: 'prefer', country: 'fi' }]
		});
		setCandidates(['470500']);
		const p = must(
			await h.place_order(ctx('chef'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'prefer',
				lines: [{ productId: '464201', qty: 4, unit: 'ST', amount: { value: 4, unit: 'l' } }]
			})
		).plan;
		const r = must(
			await h.find_substitutes(ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id
			})
		);
		expect(r.chosen[0]?.productId).toBe('470500');
		expect(r.fallback).toBe('no Finnish option qualified: picked Swedish');
	});
});
