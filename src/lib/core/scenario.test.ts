import { describe, expect, it } from 'vitest';
import type { Availability } from './contracts';
import { onScenario } from './scenario';

const cached = (logisticModel: 'Stock' | 'Terminal', closingTime: string | null): Availability => ({
	kind: 'known',
	amount: 5,
	logisticModel,
	availableDate: '2026-11-16',
	closingTime,
	raw: { closingTime },
	provenance: { source: 'valio_cache' }
});

describe('onScenario', () => {
	it('moves a Stock offer onto the delivery date with a D-1 cut-off at Valio’s time of day', () => {
		const a = onScenario(cached('Stock', '2026-11-15T17:00:00+02:00'), '2026-12-10');
		expect(a.availableDate).toBe('2026-12-10');
		expect(a.closingTime).toBe('2026-12-09T17:00:00+02:00');
		expect(a.provenance.note).toMatch(/^scenario dates: D-1/);
		expect(a.provenance.note).toContain('2026-11-15T17:00:00+02:00');
		expect(a.raw).toEqual({ closingTime: '2026-11-15T17:00:00+02:00' }); // Valio's own value kept
		expect(a).toMatchObject({ kind: 'known', amount: 5 });
	});

	it('gives a Terminal offer a D-3 cut-off, and 17:00 when Valio gave no time', () => {
		expect(
			onScenario(cached('Terminal', '2026-11-12T15:00:00+02:00'), '2026-12-10').closingTime
		).toBe('2026-12-07T15:00:00+02:00');
		expect(onScenario(cached('Terminal', null), '2026-12-10').closingTime).toBe(
			'2026-12-07T17:00:00+02:00'
		);
	});

	it('uses Helsinki summer time when the cut-off falls in it', () => {
		expect(onScenario(cached('Stock', '2026-11-15T17:00:00+02:00'), '2026-07-02').closingTime).toBe(
			'2026-07-01T17:00:00+03:00'
		);
	});

	it('leaves an offer with no dates (undeliverable) as it is', () => {
		const a: Availability = {
			...cached('Stock', null),
			availableDate: null,
			kind: 'undeliverable'
		};
		expect(onScenario(a, '2026-12-10')).toBe(a);
	});
});
