import { describe, expect, it } from 'vitest';
import {
	ESTIMATES,
	festiveFactor,
	forecast,
	isScarce,
	mixCurve,
	weekday,
	type Draw,
	type StockParams,
	type StockProduct
} from './model';

const P = (id: string, start: number | null, extra: Partial<StockProduct> = {}): StockProduct => ({
	productId: id,
	name: `Product ${id}`,
	start,
	asOf: '2026-12-07',
	logisticModel: 'Stock',
	unit: 'PCE',
	...extra
});
const params = (over: Partial<StockParams> = {}): StockParams => ({
	seed: 's1',
	from: '2026-12-07',
	days: 14,
	demandLevel: 1,
	scarcityTarget: 0,
	...over
});

describe('stock model', () => {
	it('is deterministic: the same seed gives the same weeks, another seed differs', () => {
		const ps = [P('a', 400), P('b', 120, { reliability: 0.6 })];
		const a = forecast(ps, [], ['lunch_restaurant'], params());
		expect(forecast(ps, [], ['lunch_restaurant'], params())).toEqual(a);
		expect(forecast(ps, [], ['lunch_restaurant'], params({ seed: 's2' }))).not.toEqual(a);
	});

	it('starts from Valio’s answer and labels it', () => {
		const [f] = forecast([P('a', 400)], [], [], params());
		expect(f.days[0]).toMatchObject({ day: '2026-12-07', level: 400, source: 'valio' });
		expect(f.days.slice(1).every((d) => d.source === 'model')).toBe(true);
		expect(f.days).toHaveLength(14);
	});

	it('skips products Valio gave no number for', () => {
		expect(forecast([P('a', null)], [], [], params())).toEqual([]);
	});

	it('follows the kitchen type’s weekday curve: lunch places draw on weekdays, not Sunday', () => {
		const c = mixCurve(['lunch_restaurant']);
		expect(c[0]).toBeGreaterThan(c[6] * 3);
		expect(mixCurve(['city_hotel'])[5]).toBeGreaterThan(mixCurve(['city_hotel'])[0]);
		expect(weekday('2026-12-07')).toBe(0); // a Monday
	});

	it('bumps demand before Christmas and not after', () => {
		expect(festiveFactor('2026-12-10')).toBe(1);
		expect(festiveFactor('2026-12-18')).toBeGreaterThan(1);
		expect(festiveFactor('2026-12-22')).toBe(ESTIMATES.festive.factor);
		expect(festiveFactor('2026-12-27')).toBe(1);
	});

	it('restocks warehouse items on restock days and drains committed orders on their day', () => {
		const draws: Draw[] = [
			{ productId: 'a', day: '2026-12-09', qty: 50, kitchenId: 'k', committed: true }
		];
		const [f] = forecast([P('a', 300, { reliability: 1 })], draws, [], params());
		const wed = f.days.find((d) => d.day === '2026-12-09')!;
		expect(wed.why).toContain('orders');
		const thu = f.days.find((d) => d.day === '2026-12-10')!; // weekday 3: a restock day
		expect(thu.why).toContain('restock');
		expect(thu.level).toBeGreaterThan(wed.level);
	});

	it('short-ships about (1 − reliability) of restocks', () => {
		const ps = Array.from({ length: 300 }, (_, i) =>
			P(`p${i}`, 200, { reliability: 0.8, logisticModel: 'Stock' })
		);
		const fs = forecast(ps, [], [], params({ days: 28 }));
		const restocks = fs
			.flatMap((f) => f.days.flatMap((d) => d.why))
			.filter((w) => w === 'restock' || w === 'short-ship');
		const short = restocks.filter((w) => w === 'short-ship').length / restocks.length;
		expect(short).toBeGreaterThan(0.14);
		expect(short).toBeLessThan(0.26);
	});

	it('sizes restock near the kitchens’ need for the scarcityTarget share, and only for products in play', () => {
		const ids = Array.from({ length: 400 }, (_, i) => `p${i}`);
		const share = ids.filter((id) => isScarce('s1', id, 0.3)).length / ids.length;
		expect(share).toBeGreaterThan(0.24);
		expect(share).toBeLessThan(0.36);
		const draws: Draw[] = ids.map((id) => ({
			productId: id,
			day: '2026-12-10',
			qty: 40,
			kitchenId: 'k',
			committed: false
		}));
		const fs = forecast(
			ids.map((id) => P(id, 1000)),
			draws,
			[],
			params({ scarcityTarget: 0.3 })
		);
		const scarce = fs.filter((f) => f.scarce);
		expect(scarce.length / fs.length).toBeCloseTo(share, 5);
		// A scarce product starts near the need (40 × 0.9), not at Valio's 1000; the rest keep Valio's level.
		expect(scarce.every((f) => f.days[0].level <= 40)).toBe(true);
		expect(fs.filter((f) => !f.scarce).every((f) => f.days[0].level === 1000)).toBe(true);
		// Not in play (no kitchen need): never scarce.
		expect(forecast([P('x', 1000)], [], [], params({ scarcityTarget: 1 }))[0].scarce).toBe(false);
	});

	it('applies a shortage event and finds the first short day', () => {
		const draws: Draw[] = [
			{ productId: 'a', day: '2026-12-10', qty: 30, kitchenId: 'k', committed: false }
		];
		const ev = [{ kind: 'shortage' as const, productId: 'a', day: '2026-12-09', left: 10 }];
		const [f] = forecast([P('a', 500, { reliability: 1 })], draws, [], params(), ev);
		expect(f.days.find((d) => d.day === '2026-12-09')).toMatchObject({ level: 10 });
		expect(f.shortOn).toBe('2026-12-10');
		// Products short soonest sort first.
		const both = forecast([P('b', 5000), P('a', 500, { reliability: 1 })], draws, [], params(), ev);
		expect(both[0].productId).toBe('a');
	});

	it('handles 10× demo size quickly', () => {
		const ps = Array.from({ length: 2000 }, (_, i) =>
			P(`p${i}`, 50 + (i % 400), {
				reliability: (i % 10) / 10,
				logisticModel: i % 3 ? 'Stock' : 'Terminal'
			})
		);
		const draws: Draw[] = ps.flatMap((p, i) =>
			[0, 2, 4].map((d) => ({
				productId: p.productId,
				day: `2026-12-${String(8 + d).padStart(2, '0')}`,
				qty: 5 + (i % 30),
				kitchenId: `k${i % 70}`,
				committed: d === 0
			}))
		);
		const t = performance.now();
		const fs = forecast(
			ps,
			draws,
			['lunch_restaurant', 'city_hotel', 'cafe'],
			params({ scarcityTarget: 0.3 })
		);
		expect(performance.now() - t).toBeLessThan(500);
		expect(fs).toHaveLength(2000);
		expect(fs.every((f) => f.days.every((d) => d.level >= 0 && Number.isFinite(d.level)))).toBe(
			true
		);
	});
});
