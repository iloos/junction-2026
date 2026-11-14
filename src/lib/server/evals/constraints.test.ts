/* eslint-disable @typescript-eslint/no-explicit-any -- plan and line shapes read loosely across actors */
/**
 * Strict requirements hold at every door and scope (the lead's constraint model, 14 Nov: what × scope × strength).
 * Live now, on per-line `requirements` (place_order lines, NeedRequirements):
 * - a product that breaks a strict requirement is never orderable, whoever places it (chef, the kitchen agent, an
 *   outside agent: MCP and REST reach the same handlers);
 * - nobody relaxes it by editing: swapping the line to a product that breaks it leaves the line forbidden, and
 *   committing buys nothing that breaks it;
 * - a substitute for a strict need meets it (the adversarial R7-01 guard covers the request path).
 * Pending 8d's core (order scope, prefer, best-try): `it.todo` below names each check; each becomes a test as soon as
 * the contract exists.
 * Needs the Valio catalogue in data/valio/ (the fixture catalogue reads it); skipped without it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import { trialWorkspace } from '../agent/trial-harness';

const hasData = existsSync(join('data', 'valio', 'valio_aimo_junction26_product_data.json'));
const must = (r: any) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe.skipIf(!hasData)('suite: strict requirements', () => {
	async function setup() {
		const w = await trialWorkspace();
		// Valio's lactose-free kevytmaito, and Arla's low-lactose (vähälaktoosinen, not lactose-free) whole milk: the
		// near miss a strict lactose-free requirement must catch.
		const got = (await w.env.ports.catalog.get(['464201', '463047'])) as Map<string, Product>;
		const lf = got.get('464201');
		const plain = got.get('463047');
		if (!lf?.freeFrom.includes('LACTOSE') || !plain || plain.freeFrom.includes('LACTOSE'))
			throw new Error('464201 must be lactose-free and 463047 not');
		const line = (productId: string) => ({
			productId,
			qty: 10,
			unit: 'ST',
			amount: { value: 10, unit: 'l' as const },
			requirements: { freeFrom: ['LACTOSE'] }
		});
		return { w, lf, plain, line };
	}
	const committed = (plan: any) => plan.lines.filter((l: any) => l.state === 'committed');

	for (const actor of ['chef', 'kitchen_agent', 'external_agent'] as const)
		it(`ordinary milk for a lactose-free need is never orderable when the ${actor} places it`, async () => {
			const { w, plain, line } = await setup();
			const ctx = w.ctx(actor);
			const placed = await w.handlers.place_order(ctx, {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-11',
				idempotencyKey: `strict-${actor}`,
				lines: [line(plain.productId)]
			});
			if (!placed.ok) return; // refusing the line outright is correct
			const plan = placed.value.plan;
			const l = plan.lines.find((x: any) => x.productId === plain.productId);
			expect(l?.state, `${actor}: ${JSON.stringify(l?.reasons)}`).toBe('unorderable');
			expect(l?.reasons ?? []).toContain('requirement_unmet');
			const c = await w.handlers.commit_order(w.ctx('chef'), {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: `strict-${actor}-commit`
			});
			const after = must(await w.handlers.get_plan(w.ctx('chef'), { planId: plan.id })).plan;
			expect(committed(after), `commit ${c.ok ? 'ok' : c.error.code}`).toHaveLength(0);
		});

	for (const actor of ['kitchen_agent', 'external_agent', 'chef'] as const)
		it(`the ${actor} can't relax it by swapping the line to ordinary milk`, async () => {
			const { w, lf, plain, line } = await setup();
			const plan = must(
				await w.handlers.place_order(w.ctx('chef'), {
					kitchenId: 'k-hotel',
					deliverBy: '2026-12-11',
					idempotencyKey: `relax-${actor}`,
					lines: [line(lf.productId)]
				})
			).plan;
			const e = await w.handlers.edit_line(w.ctx(actor), {
				planId: plan.id,
				version: plan.version,
				lineId: plan.lines[0].id,
				patch: { productId: plain.productId }
			});
			if (!e.ok) return; // refusing the edit is correct
			const edited = e.value.plan;
			const swapped = edited.lines.find((x: any) => x.productId === plain.productId);
			if (swapped) expect(swapped.state, JSON.stringify(swapped.reasons)).toBe('unorderable');
			expect(edited.needs[0].requirements?.freeFrom ?? []).toContain('LACTOSE');
			await w.handlers.commit_order(w.ctx('chef'), {
				planId: edited.id,
				version: edited.version,
				idempotencyKey: `relax-${actor}-commit`
			});
			const after = must(await w.handlers.get_plan(w.ctx('chef'), { planId: edited.id })).plan;
			for (const l of committed(after)) expect(l.productId).not.toBe(plain.productId);
		});

	it('a substitute for a lactose-free need is lactose-free', async () => {
		const { w, lf, line } = await setup();
		const plan = must(
			await w.handlers.place_order(w.ctx('chef'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-11',
				idempotencyKey: 'strict-sub',
				lines: [line(lf.productId)]
			})
		).plan;
		const r = await w.handlers.find_substitutes(w.ctx('kitchen_agent'), {
			planId: plan.id,
			version: plan.version,
			lineId: plan.lines[0].id
		});
		if (!r.ok) return;
		const products = (await w.env.ports.catalog.get(
			(r.value.candidates as any[]).filter((c) => c.rank !== null).map((c) => c.productId)
		)) as Map<string, Product>;
		const broken = [...products.values()].filter((p) => !p.freeFrom.includes('LACTOSE'));
		expect(broken.map((p) => `${p.productId} ${p.nameFi}`)).toEqual([]);
	});

	// 8d's core (approved 14 Nov): each becomes a test when the contract lands.
	it.todo('an order-scope strict requirement applies to every line of the order, at every door');
	it.todo(
		'a narrower scope only tightens: a line or order rule never loosens a stricter kitchen rule'
	);
	it.todo('a preference falls back only with a stated reason, and never past a strict rule');
	it.todo(
		'the agent adds strict requirements from the words but never removes one (tool boundary)'
	);
	it.todo(
		'a best-try product (breaks exactly one rule) is offered, never committed without a chef grant naming that rule'
	);
	it.todo(
		'allergen requirements have no best-try: the nearest product breaking one is never offered'
	);
});
