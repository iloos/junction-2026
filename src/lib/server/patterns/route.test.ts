import { describe, expect, it } from 'vitest';
import { PlanBody, parseOverrides, parsePeriod } from './route';

describe('/kitchen-api/usual parameters', () => {
	it('reads a window or rhythm as n days, weeks or months', () => {
		expect(parsePeriod('12w')).toEqual({ n: 12, unit: 'weeks' });
		expect(parsePeriod('6m')).toEqual({ n: 6, unit: 'months' });
		expect(parsePeriod('30d')).toEqual({ n: 30, unit: 'days' });
		expect(parsePeriod('0w')).toBeNull();
		expect(parsePeriod('12 weeks')).toBeNull();
		expect(parsePeriod(null)).toBeNull();
	});

	it('keeps only well-formed per-product overrides', () => {
		expect(parseOverrides(['464201:2w', 'junk', '12:1w', '466964:1m'])).toEqual({
			products: { '464201': { every: 2, unit: 'weeks' }, '466964': { every: 1, unit: 'months' } }
		});
		expect(parseOverrides([])).toBeUndefined();
	});

	it('plans only a kitchen, a day and real lines', () => {
		const ok = {
			kitchenId: 'k-hotel',
			deliveryDate: '2026-12-10',
			lines: [{ productId: '464201', qty: 32, unit: 'ST' }]
		};
		expect(PlanBody.safeParse(ok).success).toBe(true);
		expect(PlanBody.safeParse({ ...ok, lines: [] }).success).toBe(false);
		expect(PlanBody.safeParse({ ...ok, deliveryDate: 'Thu' }).success).toBe(false);
		expect(
			PlanBody.safeParse({ ...ok, lines: [{ productId: 'x', qty: 1, unit: 'ST' }] }).success
		).toBe(false);
	});
});

describe('the usual-order door', () => {
	it('marks the plan it places as a usual order (Plan.origin, server-set)', async () => {
		const { newVisitorWorkspace } = await import('$lib/server/demo/visitor-id');
		const { ensureRunLoaded } = await import('$lib/server/demo/reset');
		const { createServerPorts } = await import('$lib/server/store/server-ports');
		const { planUsual } = await import('./route');
		const ws = newVisitorWorkspace();
		const runId = await ensureRunLoaded(ws, { start: true });
		const r = await planUsual(ws, {
			kitchenId: 'k-hotel',
			deliveryDate: '2026-12-10',
			lines: [{ productId: '464201', qty: 32, unit: 'ST' }],
			nonce: 'origin-test'
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const { ports } = await createServerPorts();
		const plan = (await ports.store.load(ws, runId)).plans[r.planId];
		expect(plan.origin).toBe('usual');
	}, 60_000);
});
