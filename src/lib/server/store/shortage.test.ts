/**
 * Moment 1: one product runs short at Valio; every kitchen counting on it re-plans inside its own mandate. The stock
 * is shared, so earlier plans keep what is left first, and the same shortage gives each kitchen its own answer.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { replanShortage } from '$lib/core/services/shortage';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

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

/** Valio lactose-free semi-skimmed milk 1 l, and its lactose-free skimmed sibling. */
const PRODUCT = '464201';
const SUB = '464119';

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

async function order(kitchenId: string, qty: number) {
	return must(
		await h.place_order(ctx('chef'), {
			kitchenId,
			deliverBy: '2026-12-11', // a Friday: every kitchen here takes deliveries
			idempotencyKey: `short-${kitchenId}`,
			lines: [{ productId: PRODUCT, qty, unit: 'ST', amount: { value: qty, unit: 'l' } }]
		})
	).plan;
}

describe('one shortage, every kitchen re-plans', () => {
	it('three kitchens give three different answers inside their own rules', async () => {
		// The hotel ordered first and small; Lounas and the care home want 10 l each.
		const kitchens = ['k-hotel', 'k-lounas', 'k-carehome'];
		await order('k-hotel', 4);
		await order('k-lounas', 10);
		await order('k-carehome', 10);
		env.overlay.setAvailability({ productId: PRODUCT, amount: 4, label: 'simulated shortage' });
		// The obvious substitute (Valio's own rule) is in stock.
		env.overlay.setAvailability({ productId: SUB, amount: 500, label: 'simulated stock' });
		const r = must(
			await replanShortage(env.ports, ctx('kitchen_agent'), {
				productId: PRODUCT,
				had: 30,
				left: 4,
				shortageId: 'sh-1',
				note: 'Valio is short'
			})
		);
		const mine = r.kitchens.filter((k) => kitchens.includes(k.kitchenId));
		expect(mine).toHaveLength(3);
		const by = Object.fromEntries(mine.map((k) => [k.kitchenId, k]));
		// The hotel's 4 l came first and what is left covers it.
		expect(by['k-hotel'].outcome).toBe('kept');
		// Lounas lets the agent swap alone: the rest goes to the sibling without a chef.
		expect(by['k-lounas'].outcome).toBe('swapped');
		expect(by['k-lounas'].swaps[0].toProductId).toBe(SUB);
		// The care home holds new products for its chef (and stays lactose-free).
		expect(by['k-carehome'].outcome).toBe('held');
		expect(by['k-carehome'].waitsForPerson).toBeGreaterThan(0);
		// The stock is shared: together they keep at most what is left.
		const kept = mine.flatMap((k) =>
			k.changed.filter((c) => c.productId === PRODUCT && c.now).map((c) => c.now!.qty)
		);
		expect(kept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4);
		for (const k of mine) expect(k.why.length).toBeGreaterThan(10);
	}, 120_000);
});
