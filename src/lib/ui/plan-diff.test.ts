import { describe, expect, it } from 'vitest';
import type { Plan } from '$lib/core/contracts';
import { planDiff } from './plan-diff';

const kg = (value: number) => ({ value, unit: 'kg' as const });
const plan = (version: number, qty: number, cents: number, required: number, extra = false) =>
	({
		id: 'p1',
		version,
		needs: [],
		lines: [
			{
				id: 'l1',
				productId: '476768',
				productName: 'HK Palvikinkku',
				qty: { value: qty, unit: 'ST' },
				state: 'held',
				reasons: [],
				lineCents: cents
			},
			...(extra
				? [
						{
							id: 'l2',
							productId: '463159',
							productName: 'Mattila',
							qty: { value: 3, unit: 'KG' },
							state: 'held',
							reasons: [],
							lineCents: 500
						}
					]
				: [])
		],
		view: {
			fulfilment: [{ needId: 'n1', label: 'Joulukinkku (Christmas ham)', required: kg(required) }]
		}
	}) as unknown as Plan;

describe('planDiff', () => {
	it('reads the touched need, line, total and decisions from the two plans', () => {
		const d = planDiff(
			{ plan: plan(7, 13, 20059, 27), approval: null },
			{ plan: plan(8, 12, 18516, 24, true), approval: null }
		);
		expect(d).toMatchObject({
			from: 7,
			to: 8,
			needs: [{ label: 'Joulukinkku (Christmas ham)', before: 27, after: 24, unit: 'kg' }],
			lines: [
				{ lineId: 'l1', before: 13, after: 12, unit: 'ST' },
				{ lineId: 'l2', before: null, after: 3 }
			],
			cents: { before: 20059, after: 19016 },
			decisions: { before: 0, after: 0 }
		});
	});
	it('is null for another plan, an older version or no change', () => {
		expect(
			planDiff(
				{ plan: plan(7, 13, 1, 27), approval: null },
				{ plan: plan(7, 12, 1, 27), approval: null }
			)
		).toBeNull();
		expect(
			planDiff(
				{ plan: plan(7, 13, 1, 27), approval: null },
				{ plan: plan(8, 13, 1, 27), approval: null }
			)
		).toBeNull();
	});
});
