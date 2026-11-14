import { describe, expect, it } from 'vitest';
import type { Line, Plan } from '../contracts';
import { dueOf } from './due';

const line = (id: string, closes: string | null, state: Line['state'] = 'held'): Line =>
	({
		id,
		productId: id,
		qty: { value: 1, unit: 'ST' },
		state,
		reasons: [],
		offer: closes ? { availability: { closingTime: closes } } : null
	}) as unknown as Line;
const plan = (lines: Line[], validUntil?: string) =>
	({ lines, view: validUntil ? { validUntil } : undefined }) as unknown as Plan;

const TUE_15 = '2026-12-08T15:00:00+02:00';
const WED_17 = '2026-12-09T17:00:00+02:00';
const TUE_21 = '2026-12-08T21:40:00+02:00';

describe('dueOf: one due time for every surface', () => {
	it('an approval valid until 21:40 is due at its 15:00 cut-off', () => {
		const p = plan([line('a', TUE_15), line('b', WED_17)]);
		expect(dueOf(p, { expiresAt: TUE_21, lineIds: ['a', 'b'] })).toBe(TUE_15);
	});

	it("only the approval's lines count; committed lines never bind", () => {
		const p = plan([line('a', TUE_15, 'committed'), line('b', WED_17), line('c', TUE_15)]);
		expect(dueOf(p, { expiresAt: '2026-12-10T00:00:00+02:00', lineIds: ['a', 'b'] })).toBe(WED_17);
	});

	it("the plan view's validity binds too; nothing known is null", () => {
		expect(dueOf(plan([line('a', WED_17)], TUE_21))).toBe(TUE_21);
		expect(dueOf(plan([line('a', null)]))).toBeNull();
	});

	it('with now, a passed time is left out', () => {
		const p = plan([line('a', TUE_15), line('b', WED_17)]);
		expect(dueOf(p, null, undefined, new Date('2026-12-08T16:00:00+02:00'))).toBe(WED_17);
	});
});
