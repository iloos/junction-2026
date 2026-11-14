import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '../contracts';
import { basketFor } from './basket';
import { allOrderStages } from './stages';

const read = (path: string) =>
	readFileSync(path, 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => JSON.parse(l) as OpEnvelope);
const seeded = read('src/routes/ops/fixtures/seeded-ops.ndjson');
const ordered = read('src/lib/core/services/fixtures/ordered-ops.ndjson');

describe("a kitchen's basket", () => {
	it('the seeded buffet: one day, 4 orderable lines, 14 waiting on a decision, 3 that cannot be ordered', () => {
		const b = basketFor(allOrderStages(seeded), 'k-hotel', { weeklyCapCents: 500_000 });
		expect(b.days).toHaveLength(1);
		const [d] = b.days;
		expect(d.date).toBe('2026-12-10');
		expect(d.sources).toEqual([
			expect.objectContaining({
				kind: 'event',
				label: 'Event',
				startedBy: 'chef',
				approvalId: expect.any(String)
			})
		]);
		expect(d.counts).toEqual({
			orderableNow: 4,
			waitingOnDecision: 14,
			decisions: 1,
			cannotOrder: 3
		});
		expect(d.cannotOrderNames).toHaveLength(3);
		expect(d.totals.all).toBe(
			d.totals.proposed + d.totals.held + d.totals.approved + d.totals.ordered
		);
		expect(d.totals.ordered).toBe(0);
		expect(d.budget).toMatchObject({ week: '2026-W50', capCents: 500_000, orderedCents: 0 });
		expect(d.budget.ifAllOrderedCents).toBe(d.totals.all);
		expect(d.due).toBeTruthy();
		// A substitute names what it replaces; a need names its dish.
		const ham = d.lines.find((l) => l.productId === '476768')!;
		expect(ham).toMatchObject({ stage: 'held', need: 'Joulukinkku (Christmas ham)' });
		expect(ham.substituteFor).toBeTruthy();
	});

	it('an order signed and placed counts as ordered, against its week', () => {
		const b = basketFor(allOrderStages(ordered), 'k-lounas', { weeklyCapCents: 100_000 });
		const [d] = b.days;
		expect(d.lines.map((l) => l.stage)).toEqual(['ordered']);
		expect(d.counts).toMatchObject({ orderableNow: 0, waitingOnDecision: 0, decisions: 0 });
		expect(d.budget.orderedCents).toBe(d.totals.ordered);
		expect(d.due).toBeNull();
		expect(d.sources[0]).toMatchObject({ kind: 'outside_agent', approvalId: null });
	});

	it('filters by kitchen, by day and from a day on', () => {
		const stages = allOrderStages(seeded);
		expect(basketFor(stages, 'k-lounas').days).toEqual([]);
		expect(basketFor(stages, 'k-hotel', { date: '2026-12-09' }).days).toEqual([]);
		expect(basketFor(stages, 'k-hotel', { from: '2026-12-11' }).days).toEqual([]);
		expect(basketFor(stages, 'k-hotel', { from: '2026-12-10' }).days).toHaveLength(1);
	});

	it('10× the demo: ten plans for one kitchen and day merge into one day', () => {
		const text = readFileSync('src/routes/ops/fixtures/seeded-ops.ndjson', 'utf8').trim();
		const planId = (seeded[0].op as { plan: { id: string } }).plan.id;
		const copies = Array.from({ length: 10 }, (_, k) =>
			text
				.replaceAll(planId, `${planId}-x${k}`)
				.split(/\r?\n/)
				.map((l) => JSON.parse(l) as OpEnvelope)
		);
		const ops: OpEnvelope[] = [];
		for (let i = 0; i < seeded.length; i++)
			for (const c of copies) ops.push({ ...c[i], seq: ops.length + 1 });
		const t0 = performance.now();
		const b = basketFor(allOrderStages(ops), 'k-hotel');
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(b.days).toHaveLength(1);
		expect(b.days[0].sources).toHaveLength(10);
		expect(b.days[0].counts).toMatchObject({
			orderableNow: 40,
			waitingOnDecision: 140,
			decisions: 10
		});
	});
});
