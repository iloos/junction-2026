/**
 * "History earns trust": a kitchen's usual order is its own staples, so none of them is a new product to its
 * mandate, and the usual card offers the first day still orderable, never one whose cut-off has passed.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import { createHandlers } from '$lib/core/services/handlers';
import { historyProducts } from '$lib/core/mandate/tier';
import { usualFor } from '../patterns/usual';
import { loadSeedKitchens, createDbPorts } from './db-ports';

const chef = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef' as const, id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};

describe('the usual order earns trust', () => {
	it("the hotel's history staples are not new products", async () => {
		const hotel = loadSeedKitchens().find((k) => k.id === 'k-hotel')!;
		// Eggs and sliced cheese are in the hotel's history, not in its seed baseline.
		const staples = [
			{ productId: '467464', unit: 'KI' },
			{ productId: '464517', unit: 'PRK' }
		];
		for (const s of staples) expect(historyProducts(hotel.profile)).toContain(s.productId);
		const { ports } = await createDbPorts();
		const h = createHandlers(ports);
		const r = await h.place_order(
			{ ...chef, origin: 'usual' },
			{
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'usual-trust',
				lines: staples.map((s) => ({ ...s, qty: 1 }))
			}
		);
		if (!r.ok) throw new Error(r.error.message);
		for (const l of r.value.plan.lines) {
			expect(l.reasons).not.toContain('new_sku');
		}
		// Outside the usual order (a rescue, a request) the mandate still asks before a product new to the baseline.
		const other = await h.place_order(chef, {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-10',
			idempotencyKey: 'not-usual',
			lines: [{ productId: '467464', qty: 1, unit: 'KI' }]
		});
		if (!other.ok) throw new Error(other.error.message);
		expect(other.value.plan.lines[0].reasons).toContain('new_sku');
	});

	it('the usual card offers the first day still orderable, not one past its cut-off', () => {
		const hotel = loadSeedKitchens().find((k) => k.id === 'k-hotel')!;
		// Mon 7 Dec 21:40: Tuesday closed at 17:00 today, so Wednesday is the first day still open.
		const now = new Date('2026-12-07T21:40:00+02:00');
		expect(usualFor(hotel, '2026-12-07', { now }).deliveryDate).toBe('2026-12-09');
		// Before the cut-off, Tuesday is still offered.
		const early = new Date('2026-12-07T10:00:00+02:00');
		expect(usualFor(hotel, '2026-12-07', { now: early }).deliveryDate).toBe('2026-12-08');
	});
});
