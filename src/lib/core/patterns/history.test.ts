import { describe, expect, it } from 'vitest';
import recipesJson from '../../../../fixtures/seeds/usual-history.json';
import kitchensJson from '../../../../fixtures/seeds/kitchens.json';
import buffet from '../../../../fixtures/seeds/christmas-buffet-140.json';
import substitutes from '../../../../evals/retrieval/substitutes.json';
import { SIMULATED_HISTORY, simulateHistory, type HistoryRecipes } from './history';
import { usualOrder } from './usual';
import { weekdayOf, type Weekday } from './dates';

const recipes = recipesJson as HistoryRecipes;
const AS_OF = '2026-12-07';
const kitchen = (id: string) => {
	const k = kitchensJson.kitchens.find((x) => x.id === id)!;
	return { id: k.id, profile: k.profile, deliveryDays: k.deliveryDays as Weekday[] };
};
const history = (id: string, asOf = AS_OF) => simulateHistory(recipes, kitchen(id), asOf);

describe('simulateHistory', () => {
	it('is deterministic and labels every line', () => {
		const a = history('k-hotel');
		expect(history('k-hotel')).toEqual(a);
		expect(a.label).toBe(SIMULATED_HISTORY);
		expect(a.lines.length).toBeGreaterThan(300);
		expect(a.lines.every((l) => l.source === SIMULATED_HISTORY)).toBe(true);
		expect(a.lines.every((l) => l.date >= a.from && l.date < AS_OF)).toBe(true);
	});

	it('keeps a date’s order the same as the sim day moves', () => {
		const day = '2026-11-20';
		const at = (asOf: string) => history('k-lounas', asOf).lines.filter((l) => l.date === day);
		// Recurring lines only: joined/dropped/one-off items are placed relative to asOf.
		const steady = new Set(['475214', '474247', '464249', '464201']);
		const pick = (asOf: string) => at(asOf).filter((l) => steady.has(l.productId));
		expect(pick('2026-12-08')).toEqual(pick(AS_OF));
	});

	it('uses only product ids already in the fixtures', () => {
		const known = new Set(
			JSON.stringify([buffet, kitchensJson, substitutes]).match(/\b4\d{5}\b/g) ?? []
		);
		const ids = Object.values(recipes.profiles).flatMap((p) => p.items.map((i) => i.productId));
		expect(ids.filter((id) => !known.has(id))).toEqual([]);
	});

	it('keeps P3 inside its tender list', () => {
		const tender = new Set(
			kitchensJson.kitchens.find((k) => k.id === 'k-central')!.constraints.tenderList
		);
		expect(history('k-central').lines.every((l) => tender.has(l.productId))).toBe(true);
	});

	it('orders only on receiving days: the lunch place never on weekends', () => {
		const days = new Set(history('k-lounas').lines.map((l) => weekdayOf(l.date)));
		expect([...days].sort()).toEqual(['fri', 'mon', 'wed']);
	});

	it('drops the central kitchen to about zero in the autumn break', () => {
		const lines = history('k-central').lines;
		const inBreak = lines.filter((l) => l.date >= '2026-10-12' && l.date <= '2026-10-16');
		const week = lines.filter((l) => l.date >= '2026-10-19' && l.date <= '2026-10-23');
		const sum = (xs: typeof lines) => xs.reduce((n, l) => n + l.qty, 0);
		expect(inBreak.every((l) => l.productId === '464201')).toBe(true);
		expect(sum(inBreak)).toBeLessThan(0.1 * sum(week));
	});
});

describe('usual orders over the simulated history', () => {
	const usual = (id: string, date: string) =>
		usualOrder({
			lines: history(id).lines,
			deliveryDate: date,
			asOf: AS_OF,
			deliveryDays: kitchen(id).deliveryDays
		});

	it('hotel, Thu 10 Dec: breakfast staples settled; oat drink joined; trout dropped', () => {
		const u = usual('k-hotel', '2026-12-10');
		expect(u.settled).toBe(true);
		expect(u.lines.map((l) => l.productId)).toEqual(
			expect.arrayContaining(['464201', '467464', '463400'])
		);
		expect(u.joined.map((c) => c.productId)).toEqual(['464320']);
		expect(u.dropped.map((c) => c.productId)).toEqual(['462016']);
		// One-offs never become usual.
		expect(u.lines.map((l) => l.productId)).not.toContain('462919');
	});

	it('hotel: porridge rice every other Wednesday, on its own phase', () => {
		const wed = usual('k-hotel', '2026-12-09').lines.find((l) => l.productId === '466964');
		expect(wed?.period).toEqual({ kind: 'weekly', weekday: 'wed', everyWeeks: 2 });
		expect(usual('k-hotel', '2026-12-16').lines.map((l) => l.productId)).not.toContain('466964');
	});

	it('lunch, Wed 9 Dec: the week’s main lines; yoghurt joined and due', () => {
		const u = usual('k-lounas', '2026-12-09');
		expect(u.lines.map((l) => l.productId)).toEqual(
			expect.arrayContaining(['475214', '470418', '462209', '474247', '464201'])
		);
		expect(u.joined).toMatchObject([{ productId: '465845', dueOnDay: true }]);
		expect(u.dropped.map((c) => c.productId)).toEqual(['462197']);
	});

	it('central kitchen, Tue 8 Dec: milk and the every-other-week fish day', () => {
		const u = usual('k-central', '2026-12-08');
		const fish = u.lines.find((l) => l.productId === '462016');
		expect(fish?.period).toEqual({ kind: 'weekly', weekday: 'tue', everyWeeks: 2 });
		expect(fish?.unit).toBe('KG');
		expect(fish!.qty % 10).toBe(0);
		expect(u.lines.map((l) => l.productId)).toContain('464201');
		expect(u.dropped.map((c) => c.productId)).toEqual(['472186']);
	});
});

describe('every seeded kitchen has a history', () => {
	it('all seven kitchens get non-empty simulated history, on their own receiving days', () => {
		for (const k of kitchensJson.kitchens) {
			const h = history(k.id);
			expect(h.lines.length, k.id).toBeGreaterThan(0);
			expect(
				h.lines.every((l) => (k.deliveryDays as Weekday[]).includes(weekdayOf(l.date))),
				k.id
			).toBe(true);
		}
	});

	it('ski hotel: the off season runs at a fraction of the season', () => {
		const milk = history('k-skiresort').lines.filter((l) => l.productId === '464201');
		const avg = (xs: { qty: number }[]) =>
			xs.reduce((s, l) => s + l.qty, 0) / Math.max(1, xs.length);
		const off = milk.filter((l) => l.date <= '2026-11-26');
		const season = milk.filter((l) => l.date > '2026-11-26');
		expect(season.length).toBeGreaterThan(0);
		expect(avg(off)).toBeLessThan(avg(season) * 0.5);
	});

	it('café: coffee milk on every receiving day, small amounts', () => {
		const milk = history('k-cafe').lines.filter((l) => l.productId === '464237');
		const days = new Set(milk.map((l) => weekdayOf(l.date)));
		expect([...days].sort()).toEqual(['fri', 'mon', 'sat', 'thu', 'tue', 'wed']);
		expect(Math.max(...milk.map((l) => l.qty))).toBeLessThan(20);
	});
});
