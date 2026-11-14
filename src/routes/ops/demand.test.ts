import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { allOrderStages } from '$lib/core/services/stages';
import { demandByDay } from './demand';

const read = (path: string) =>
	readFileSync(path, 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => JSON.parse(l) as OpEnvelope);
const names: Record<string, string> = { 'k-hotel': 'Hotel', 'k-lounas': 'Lounas' };
const kitchen = (id: string) => names[id] ?? id;

describe("demand, Valio's view", () => {
	it('the seeded buffet: one day, everything still proposed, no swaps accepted yet', () => {
		const [d] = demandByDay(
			allOrderStages(read('src/routes/ops/fixtures/seeded-ops.ndjson')),
			kitchen
		);
		expect(d.date).toBe('2026-12-10');
		expect(d.sentence).toBe('Thu 10 Dec: 1 kitchen, 18 lines.');
		expect(d.products.every((p) => p.ordered === 0 && p.signed === 0 && p.proposed > 0)).toBe(true);
		// Products the kitchen can't get are not demand: the out-of-stock ham is absent, its substitute present.
		expect(d.products.some((p) => p.productId === '462490')).toBe(false);
		expect(d.products.some((p) => p.productId === '476768')).toBe(true);
		expect(d.swaps).toEqual([]);
		expect(d.waived).toEqual([]);
	});

	it('an order signed and placed: ordered quantities, no proposals left', () => {
		const [d] = demandByDay(
			allOrderStages(read('src/lib/core/services/fixtures/ordered-ops.ndjson')),
			kitchen
		);
		expect(d.sentence).toBe('Wed 9 Dec: 1 kitchen, 1 line.');
		expect(d.products).toEqual([
			expect.objectContaining({
				productId: '460692',
				ordered: 3,
				signed: 0,
				proposed: 0,
				kitchens: 1
			})
		]);
	});

	it('days come in date order', () => {
		const stages = [
			...allOrderStages(read('src/routes/ops/fixtures/seeded-ops.ndjson')),
			...allOrderStages(read('src/lib/core/services/fixtures/ordered-ops.ndjson'))
		];
		expect(demandByDay(stages, kitchen).map((d) => d.date)).toEqual(['2026-12-09', '2026-12-10']);
	});
});
