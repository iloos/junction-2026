import { describe, expect, it } from 'vitest';
import { EventSeed, planEventDemand } from '$lib/core/demand';
import { ALL_KITCHENS, KITCHENS } from './catalog';
import { EVENT_SEEDS, eventFor } from './events';
import { buildEvent, dishesFor, rulesFor } from './fixture-plan';

describe('each kitchen has its own event', () => {
	it('maps the three demo kitchens to their events, and no kitchen to two', () => {
		expect(eventFor('k-hotel')?.id).toBe('event-xmas-140');
		expect(eventFor('k-lounas')?.id).toBe('event-lounas-wed-320');
		expect(eventFor('k-central')?.id).toBe('event-school-day-2000');
		const owners = EVENT_SEEDS.map((e) => e.kitchenId);
		expect(new Set(owners).size).toBe(owners.length);
	});

	it('offers only kitchens with an event on the kitchen screen; the control room keeps all seven', () => {
		expect(KITCHENS.map((k) => k.id)).toEqual(['k-hotel', 'k-lounas', 'k-central']);
		expect(ALL_KITCHENS).toHaveLength(7);
	});

	it.each(EVENT_SEEDS.map((e) => [e.id, e] as const))(
		'%s parses, and the planner reproduces every order in the seed',
		(_, raw) => {
			const seed = EventSeed.parse(raw);
			const { lines } = planEventDemand(seed);
			const stated = seed.dishes.map((d) => (d as { order?: { qty: number } }).order?.qty);
			expect(lines.map((l) => l.qty.value)).toEqual(stated);
		}
	);

	it("serves a dish's share of the guests, and the share follows an edited guest count", () => {
		const seed = EventSeed.parse(eventFor('k-central'));
		const glutenFree = (guests: number) =>
			planEventDemand(seed, { guests }).lines.find((l) => l.productId === '461765')!;
		// 3% of 2,000 pupils × 38 g = 2.28 kg of gluten-free bread; at 4,000 pupils, twice that.
		expect(glutenFree(2000).needAmount.value).toBeCloseTo(2.28, 6);
		expect(glutenFree(4000).needAmount.value).toBeCloseTo(4.56, 6);
	});
});

describe('the offline kitchen builds each kitchen its own event', () => {
	it.each(KITCHENS.map((k) => [k.id, k] as const))('%s', (_, kitchen) => {
		const event = eventFor(kitchen.id)!;
		const built = buildEvent({
			kitchen,
			eventId: event.id,
			rules: rulesFor(kitchen, 'kitchen'),
			grams: {},
			scenario: { guests: event.guests.estimate, contention: false, weekSpentCents: 0 },
			version: 1,
			committed: {}
		});
		expect(built.plan.eventId).toBe(event.id);
		expect(built.plan.kitchenId).toBe(kitchen.id);
		expect(built.view.title).toBe(event.title);
		expect(built.view.dishes).toHaveLength(dishesFor(event.id).length);
		expect(built.plan.lines.length).toBeGreaterThan(0);
	});

	it('keeps the hotel on its Christmas plan id, so links and evals still find it', () => {
		const hotel = KITCHENS.find((k) => k.id === 'k-hotel')!;
		const built = buildEvent({
			kitchen: hotel,
			rules: rulesFor(hotel, 'kitchen'),
			grams: {},
			scenario: { guests: 140, contention: false, weekSpentCents: 0 },
			version: 1,
			committed: {}
		});
		expect(built.plan.id).toBe('plan-xmas-140');
	});

	it('counts an ordinary day inside the normal week, and the Christmas buffet on top of it', () => {
		const build = (id: string) => {
			const k = KITCHENS.find((x) => x.id === id)!;
			const e = eventFor(id)!;
			return buildEvent({
				kitchen: k,
				eventId: e.id,
				rules: rulesFor(k, 'kitchen'),
				grams: {},
				scenario: { guests: e.guests.estimate, contention: false, weekSpentCents: 0 },
				version: 1,
				committed: {}
			}).view;
		};
		const lunch = build('k-lounas');
		expect(lunch.thisWeek).toEqual(lunch.normalWeek);
		const hotel = build('k-hotel');
		expect(hotel.thisWeek.cents).toBeGreaterThan(hotel.normalWeek.cents);
	});
});
