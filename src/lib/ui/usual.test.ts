import { describe, expect, it } from 'vitest';
import { usualHeadline } from './usual';

const eur = (c: number) => `€${Math.round(c / 100)}`;

describe('usual headline', () => {
	it("says the agent's work: the day's usual is ready, with lines and price", () => {
		expect(
			usualHeadline(
				{ weekday: 'Tuesday', deliveryDate: '2026-12-08', lines: 5, cents: 27200, unpriced: 0 },
				eur
			)
		).toBe("Tuesday's usual is ready: 5 lines, €272. Plan it, or change a line.");
	});
	it('marks a partial price and a single line', () => {
		expect(
			usualHeadline(
				{ weekday: 'Friday', deliveryDate: '2026-12-11', lines: 1, cents: 1000, unpriced: 1 },
				eur
			)
		).toBe("Friday's usual is ready: 1 line, €10 so far. Plan it, or change a line.");
	});
});
