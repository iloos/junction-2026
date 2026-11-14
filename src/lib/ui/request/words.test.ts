import { describe, expect, it } from 'vitest';
import type { Line } from '$lib/core/contracts';
import { reasonWords, tierWords } from './words';

const caps = { lineCapCents: 80000, orderCapCents: 100000, weeklyCapCents: 400000 };
const line = { lineCents: 1000, qty: { value: 1 } } as unknown as Line;

describe('hold words', () => {
	it('names the kitchen and its delivery days for an off-day hold', () => {
		expect(
			reasonWords('off_delivery_day', line, null, caps, {
				name: 'Hotel Rautatientori',
				deliveryDays: ['mon', 'wed', 'fri']
			})
		).toBe('Hotel Rautatientori takes deliveries on Mon, Wed, Fri');
		expect(reasonWords('superseded', line, null, caps)).toBe(
			'replaced by a substitute; not bought'
		);
	});
	it('says "over the limits" only for a spending hold', () => {
		expect(tierWords('sign_off', ['off_delivery_day']).body).toBe(
			'Needs the named approver: not a delivery day.'
		);
		expect(tierWords('sign_off', ['CAP_EXCEEDED.order']).body).toMatch(/^Over the limits you set/);
	});
});
