import { describe, expect, it } from 'vitest';
import sims from './fixtures/room-events.json';
import {
	lastShortage,
	orderFeed,
	roomKitchens,
	roomOrder,
	firstOrders,
	shortageCounts,
	storesCreated,
	storeTotals,
	type OpsKitchen
} from './room';
import type { Order } from '$lib/core/contracts';

const seeded: OpsKitchen[] = [
	{
		id: 'k-hotel',
		name: 'Hotel Rautatientori',
		kind: 'city_hotel',
		city: 'Helsinki',
		mandateWords: 'w',
		weeklyCapCents: 1
	}
];

describe('room', () => {
	it('adds each created store once, after the loaded kitchens', () => {
		const created = storesCreated(sims);
		expect(created.map((c) => c.name)).toEqual(["Aino's Lunch Bar", 'Hilltop Care']);
		// The replayed event (seq 45) keeps the first details.
		expect(created[0].mandateWords).toMatch(/usual lunch week/);
		const all = roomKitchens(seeded, created);
		expect(all.map((k) => k.id)).toEqual(['k-hotel', 'k-v-a1b2c3', 'k-v-d4e5f6']);
		expect(all[1].copiedFrom).toBe('k-lounas');
		// A store the page already loaded is not doubled.
		expect(roomKitchens(all, created)).toHaveLength(3);
	});

	it('reads the newest shortage and counts its outcomes', () => {
		const s = lastShortage(sims)!;
		expect(s).toMatchObject({ productName: 'Valio milk 1 l', had: 400, left: 60 });
		expect(s.kitchens).toHaveLength(3);
		expect(shortageCounts(s)).toMatchObject({ swapped: 1, held: 1, unaffected: 1 });
		expect(lastShortage([])).toBeNull();
	});

	it('lists orders newest first with the store name, and totals per store', () => {
		const o = (id: string, kitchenId: string, at: string, cents: number) =>
			({
				id,
				kitchenId,
				committedAt: at,
				totalCents: cents,
				deliverBy: '2026-12-09',
				lines: [{}]
			}) as unknown as Order;
		const orders = {
			a: o('a', 'k-hotel', '2026-12-07T21:00:00Z', 1000),
			b: o('b', 'k-v-a1b2c3', '2026-12-07T21:05:00Z', 2500),
			c: o('c', 'k-hotel', '2026-12-07T21:10:00Z', 500)
		};
		const name = (id: string) => (id === 'k-hotel' ? 'Hotel' : 'Aino');
		expect(orderFeed(orders, name).map((f) => [f.id, f.kitchenName])).toEqual([
			['c', 'Hotel'],
			['b', 'Aino'],
			['a', 'Hotel']
		]);
		expect(storeTotals(orders)['k-hotel']).toEqual({ n: 2, cents: 1500 });
	});

	it('puts made stores first, then stores with orders, then the quiet samples', () => {
		const all = roomKitchens(
			[...seeded, { ...seeded[0], id: 'k-cafe', name: 'Cafe' }],
			storesCreated(sims)
		);
		const { active, samples } = roomOrder(all, { 'k-cafe': { n: 1, cents: 900 } });
		expect(active.map((k) => k.id)).toEqual(['k-v-d4e5f6', 'k-v-a1b2c3', 'k-cafe']);
		expect(samples.map((k) => k.id)).toEqual(['k-hotel']);
	});

	it('finds stores whose first order just landed', () => {
		expect(firstOrders({ a: { n: 1 } }, { a: { n: 2 }, b: { n: 1 } })).toEqual(['b']);
		expect(firstOrders({}, {})).toEqual([]);
	});
});
