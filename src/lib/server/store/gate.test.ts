/**
 * Review round 3, findings 1–3: the gate never buys more than approved, never orders without a price, and the
 * kitchen's hard rules (allergens, origin, sales unit) rule a line out before any approval can see it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { SCOPES_BY_ACTOR, type Kitchen, type Offer, type Product } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { tierLines } from '$lib/core/mandate/tier';
import { validateLine } from '$lib/core/mandate/validate';
import * as schema from '../db/schema';
import { createDbPorts, loadSeedKitchens } from './db-ports';

const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

/** One held line of 470418 for the lunch kitchen, approved; returns what a commit needs. */
async function approvedOne() {
	const p = must(
		await h.place_order(ctx('chef'), {
			kitchenId: 'k-lounas',
			deliverBy: '2026-12-10',
			idempotencyKey: 'one',
			lines: [{ productId: '470418', qty: 1, unit: 'ST' }]
		})
	);
	const v = must(await h.get_plan(ctx('chef'), { planId: p.plan.id }));
	if (v.approval)
		must(
			await h.approve(ctx('approver'), {
				approvalId: v.approval.id,
				planVersion: v.approval.planVersion,
				termsHash: v.approval.termsHash,
				decision: 'grant'
			})
		);
	return { plan: v.plan, lineId: v.plan.lines[0].id };
}

async function counts() {
	const orders = await env.db.select().from(schema.orders);
	const budgets = await env.db.select().from(schema.budgets);
	const stock = await env.db
		.select()
		.from(schema.simStock)
		.where(eq(schema.simStock.productId, '470418'));
	return {
		orders: orders.length,
		spent: budgets.reduce((s, b) => s + b.spentCents, 0),
		stock: stock[0]?.available ?? null
	};
}

describe('finding 1: a repeated line id never buys twice', () => {
	it('refuses duplicate lineIds with nothing changed, then commits once and replays', async () => {
		const { plan, lineId } = await approvedOne();
		const before = await counts();
		const dup = await h.commit_order(ctx('chef'), {
			planId: plan.id,
			version: plan.version,
			idempotencyKey: 'dup',
			lineIds: [lineId, lineId]
		});
		expect(code(dup)).toBe('INVALID_INPUT');
		expect(await counts()).toEqual(before);

		const input = {
			planId: plan.id,
			version: plan.version,
			idempotencyKey: 'once',
			lineIds: [lineId]
		};
		const a = must(await h.commit_order(ctx('chef'), input));
		const b = must(await h.commit_order(ctx('chef'), input));
		expect(b.receiptId).toBe(a.receiptId);
		expect(a.totalCents).toBe(2520);
		const after = await counts();
		expect(after.orders).toBe(1);
		expect(after.spent).toBe(2520);
		expect(after.stock).toBe(60); // 61 in stock, one bought once
	});
});

describe('finding 2: no price, no order', () => {
	it('holds a priceless line outside any approval, refuses to commit it, and a new price means new terms', async () => {
		env.overlay.setPriceMissing('470418', 'simulated: Valio returned no price');
		const p = must(
			await h.place_order(ctx('chef'), {
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-10',
				idempotencyKey: 'noprice',
				lines: [{ productId: '470418', qty: 1, unit: 'ST' }]
			})
		);
		const line = p.plan.lines[0];
		expect(line).toMatchObject({ state: 'held', lineCents: null });
		expect(line.reasons).toContain('price_missing');
		expect(p.approvalId).toBeNull(); // a fact gap is never put to a human

		const c = await h.commit_order(ctx('chef'), {
			planId: p.plan.id,
			version: p.plan.version,
			idempotencyKey: 'c1',
			lineIds: [line.id]
		});
		expect(code(c)).not.toBe('ok');
		expect((await counts()).orders).toBe(0);

		// The price arrives: the terms change, so the commit refuses and a fresh approval is needed.
		env.overlay.clear();
		const c2 = await h.commit_order(ctx('chef'), {
			planId: p.plan.id,
			version: p.plan.version,
			idempotencyKey: 'c2',
			lineIds: [line.id]
		});
		expect(code(c2)).toBe('TERMS_CHANGED');
		const v = must(await h.get_plan(ctx('chef'), { planId: p.plan.id }));
		expect(v.plan.lines[0].lineCents).toBe(2520);
		expect((await counts()).orders).toBe(0);
	});
});

describe('finding 3: one validator, five hard cases', () => {
	const kitchen = (over: Partial<Kitchen['constraints']>): Kitchen => {
		const k = loadSeedKitchens().find((x) => x.id === 'k-central')!;
		return {
			...k,
			constraints: {
				...k.constraints,
				tenderListOnly: false,
				allergens: { freeFrom: ['AM'], unknownCounts: 'hold' },
				...over
			},
			mandate: { ...k.mandate, neverDelegate: [] }
		};
	};
	const product = (over: Partial<Product>): Product => ({
		productId: '463437',
		nameFi: 'test',
		category: '10500',
		categoryGroup: '10',
		isFood: true,
		vendor: 'v',
		origin: 'fi',
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
		...over
	});
	const offer: Offer = {
		productId: '463437',
		price: {
			unitCents: 331,
			comparison: null,
			taxRate: 13.5,
			validTo: null,
			provenance: { source: 'seed' }
		},
		availability: {
			kind: 'known',
			amount: null,
			logisticModel: 'Stock',
			availableDate: '2026-12-10',
			closingTime: null,
			raw: null,
			provenance: { source: 'seed' }
		}
	};
	const qty = { value: 1, unit: 'ST' };
	const effects = (k: Kitchen, p: Product, q = qty) =>
		validateLine(k, p, offer, q).map((f) => `${f.reason}:${f.effect}`);

	it('declared allergen: forbidden', () => {
		expect(
			effects(
				kitchen({}),
				product({ allergens: { contains: ['AM'], mayContain: [], declared: true } })
			)
		).toContain('allergen_declared:forbid');
	});
	it('trace allergen: held or forbidden by the kitchen policy', () => {
		const trace = product({ allergens: { contains: [], mayContain: ['AM'], declared: true } });
		expect(effects(kitchen({}), trace)).toContain('allergen_trace:waive');
		expect(
			effects(
				kitchen({ allergens: { freeFrom: ['AM'], unknownCounts: 'hold', traces: 'reject' } }),
				trace
			)
		).toContain('allergen_trace:forbid');
	});
	it('missing allergen record: held or forbidden by the kitchen policy', () => {
		const none = product({ allergens: { contains: [], mayContain: [], declared: false } });
		expect(effects(kitchen({}), none)).toContain('allergen_unknown:waive');
		expect(
			effects(kitchen({ allergens: { freeFrom: ['AM'], unknownCounts: 'reject' } }), none)
		).toContain('allergen_unknown:forbid');
	});
	it('wrong required origin: forbidden (the word "meat" maps to its categories)', () => {
		const se = product({
			productId: '463159',
			category: '17203',
			origin: 'de',
			allergens: { contains: [], mayContain: [], declared: true }
		});
		expect(effects(kitchen({}), se)).toContain('origin_required:forbid');
		expect(effects(kitchen({}), product({ category: '17203', origin: 'fi' }))).not.toContain(
			'origin_required:forbid'
		);
	});
	it('wrong sales unit: forbidden', () => {
		expect(effects(kitchen({}), product({}), { value: 1, unit: 'KG' })).toContain(
			'unit_mismatch:forbid'
		);
	});

	it('a forbidden line is unorderable and never enters an approval, even with no other reason', () => {
		const k = kitchen({});
		const p = product({ allergens: { contains: ['AM'], mayContain: [], declared: true } });
		const t = tierLines({
			kitchen: k,
			lines: [{ id: 'l1', productId: p.productId, qty, provenance: { source: 'user' } }],
			offers: new Map([[p.productId, offer]]),
			products: new Map([[p.productId, p]]),
			weekSpentCents: 0,
			actor: 'chef',
			createdBy: 'chef',
			orderedBefore: new Set([p.productId])
		});
		expect(t.lines[0]).toMatchObject({ state: 'unorderable', reasons: ['allergen_declared'] });
		expect(t.held).toBeNull();
	});

	it('through the handlers: non-FI meat for the central kitchen is unorderable and cannot be committed', async () => {
		const p = must(
			await h.place_order(ctx('chef'), {
				kitchenId: 'k-central',
				deliverBy: '2026-12-10',
				idempotencyKey: 'de-ham',
				lines: [{ productId: '463159', qty: 1.8, unit: 'KG' }]
			})
		);
		expect(p.plan.lines[0]).toMatchObject({ state: 'unorderable' });
		expect(p.plan.lines[0].reasons).toContain('origin_required');
		const c = await h.commit_order(ctx('chef'), {
			planId: p.plan.id,
			version: p.plan.version,
			idempotencyKey: 'x',
			lineIds: [p.plan.lines[0].id]
		});
		expect(code(c)).toBe('FORBIDDEN');
		expect((await env.db.select().from(schema.orders)).length).toBe(0);
	});
});
