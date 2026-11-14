import { describe, expect, it } from 'vitest';
import { humanDates } from './format';

describe('humanDates', () => {
	it('reads ISO dates and times as a person would', () => {
		expect(humanDates('Valio cache had cut-off 2026-11-15T17:00:00+02:00')).toBe(
			'Valio cache had cut-off Sun 15 Nov, 17:00'
		);
		expect(humanDates('for delivery 2026-12-14')).toMatch(/for delivery Mon 14 Dec/);
		expect(humanDates('no dates here')).toBe('no dates here');
	});
});
