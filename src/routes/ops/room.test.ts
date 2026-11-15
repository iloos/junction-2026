import { describe, expect, it } from 'vitest';
import sims from './fixtures/room-events.json';
import {
	lastShortage,
	orderFeed,
	roomKitchens,
	roomOrder,
	lastIncident,
	firstOrders,
	shortageCounts,
	storesCreated,
	storeTotals,
	storeStates,
	byActivity,
	ordersLastMinute,
	kindCounts,
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

	it('counts a blank visitor store (no sample to copy) as a store, not a sample', () => {
		const blank = { ...seeded[0], id: 'k-v-abc123', name: 'Playtest Bistro', kind: 'blank' };
		const owned = { ...seeded[0], id: 'k-x', name: 'Owned', visitor: true };
		const { active, samples } = roomOrder([seeded[0], blank, owned], {});
		expect(active.map((k) => k.id)).toEqual(['k-x', 'k-v-abc123']);
		expect(samples.map((k) => k.id)).toEqual(['k-hotel']);
	});

	it('groups the newest incident’s shortage notices, in order, and ignores a plain shortage after it', () => {
		const n = (seq: number, label: string, productId: string) => ({
			seq,
			event: {
				kind: 'shortage.replanned',
				label,
				detail: { shortageId: `s${seq}`, productId, productName: productId, kitchens: [] }
			}
		});
		const inc = 'Simulated incident: Rush';
		const run = [n(1, 'other', 'x'), n(2, inc, 'a'), n(3, inc, 'b')];
		const got = lastIncident(run, 'Simulated incident')!;
		expect(got.label).toBe(inc);
		expect(got.shortages.map((s) => s.productId)).toEqual(['a', 'b']);
		// A plain Kitchen shortage after the incident: the incident is no longer the newest.
		expect(
			lastIncident([...run, n(4, 'simulated: Valio is short', 'z')], 'Simulated incident')
		).toBeNull();
	});
});

describe('room at scale', () => {
	const k = (id: string, extra: Partial<OpsKitchen> = {}) =>
		({ id, name: id, kind: 'blank', city: '', ...extra }) as OpsKitchen;
	it('one state per store: ordered, waiting, planning, joined', () => {
		const ks = [k('k-v-a'), k('k-v-b'), k('k-v-c'), k('k-v-d')];
		const s = storeStates(
			ks,
			{ 'k-v-a': { n: 1 } },
			[{ kitchenId: 'k-v-b' }, { kitchenId: 'k-v-c' }],
			new Set(['k-v-b'])
		);
		expect(s).toEqual({
			'k-v-a': 'ordered',
			'k-v-b': 'waiting',
			'k-v-c': 'planning',
			'k-v-d': 'joined'
		});
	});
	it('latest order first, then waiting, planning, the newest joiners, samples last', () => {
		const ks = [k('k-hotel'), k('k-v-1'), k('k-v-2'), k('k-v-3'), k('k-v-4')];
		const states = storeStates(
			ks,
			{ 'k-v-1': { n: 1 } },
			[{ kitchenId: 'k-v-2' }],
			new Set(['k-v-2'])
		);
		const feed = [
			{
				id: 'o',
				kitchenId: 'k-v-1',
				kitchenName: '',
				lines: 1,
				totalCents: 1,
				committedAt: '2026-12-07T10:00:00Z',
				deliverBy: ''
			}
		];
		expect(byActivity(ks, states, feed).map((x) => x.id)).toEqual([
			'k-v-1',
			'k-v-2',
			'k-v-4',
			'k-v-3',
			'k-hotel'
		]);
	});
	it('counts the orders of the last minute', () => {
		const now = Date.parse('2026-12-07T10:01:00Z');
		const at = (s: string) => ({
			id: s,
			kitchenId: 'x',
			kitchenName: '',
			lines: 1,
			totalCents: 1,
			committedAt: s,
			deliverBy: ''
		});
		expect(ordersLastMinute([at('2026-12-07T10:00:30Z'), at('2026-12-07T09:59:00Z')], now)).toBe(1);
	});
});

describe('kinds in the room', () => {
	const v = (id: string, kind: string, copiedFrom?: string) =>
		({ id, name: id, kind, city: '', ...(copiedFrom ? { copiedFrom } : {}) }) as OpsKitchen;
	it('counts visitor stores by kind, biggest first; blank and samples left out', () => {
		const ks = [
			v('k-v-1', 'cafe', 'k-cafe'),
			v('k-v-2', 'lunch_restaurant', 'k-lounas'),
			v('k-v-3', 'lunch_restaurant', 'k-lounas'),
			v('k-v-4', 'blank'),
			v('k-hotel', 'city_hotel')
		];
		expect(kindCounts(ks)).toBe('2 lunch places · 1 café');
	});
});
