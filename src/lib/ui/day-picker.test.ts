import { describe, expect, it } from 'vitest';
import factors from '../../../fixtures/seeds/calendar-factors.json';
import { calendarDays } from '$lib/core/calendar';
import {
	cellWord,
	daySentence,
	markLine,
	monthRange,
	pickable,
	shiftMonth,
	weeksOf
} from './day-picker';

const days = calendarDays(
	{
		kitchen: { id: 'k-hotel', name: 'Hotel', deliveryDays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
		now: '2026-12-07T21:40:00+02:00',
		closeTimes: { Terminal: '15:00' },
		decisions: [{ key: 'a', title: 'New product (7 lines)', due: '2026-12-08T15:00:00+02:00' }],
		deliveries: [],
		closedDays: factors.holidays.days,
		factors: factors.factors
	},
	'2026-12-07',
	'2026-12-27'
);
const at = (d: string) => days.find((x) => x.date === d)!;

describe('day picker words', () => {
	it('picks by logistic model', () => {
		expect(pickable(at('2026-12-09'))).toBe(true);
		expect(pickable(at('2026-12-09'), 'Terminal')).toBe(false);
		expect(pickable(at('2026-12-10'), 'Terminal')).toBe(true);
		expect(pickable(at('2026-12-13'))).toBe(false);
		expect(pickable(at('2026-12-25'))).toBe(false);
	});

	it('gives each cell one short word', () => {
		expect(days.map((d) => cellWord(d)).every((w) => w.length <= 7)).toBe(true);
		expect(cellWord(at('2026-12-09'))).toBe('Stock');
		expect(cellWord(at('2026-12-09'), 'Terminal')).toBe('Closed');
		expect(cellWord(at('2026-12-25'))).toBe('Holiday');
		expect(cellWord(at('2026-12-10'))).toBe('');
	});

	it('explains a day in one sentence', () => {
		expect(daySentence(at('2026-12-10'))).toBe(
			"Thu 10 Dec: delivery. Order by Tue 8 Dec, 15:00 for supplier-delivered items · Wed 9 Dec, 17:00 for Valio's warehouse items."
		);
		expect(daySentence(at('2026-12-10'), 'Terminal')).toBe(
			'Thu 10 Dec: delivery. Order by Tue 8 Dec, 15:00.'
		);
		expect(daySentence(at('2026-12-09'))).toBe(
			"Wed 9 Dec: Valio's warehouse items only; supplier-delivered items closed Mon 7 Dec, 15:00. Order by Tue 8 Dec, 17:00."
		);
		expect(daySentence(at('2026-12-25'))).toBe(
			'Fri 25 Dec: Christmas Day, no delivery. Its order goes on Wed 23 Dec.'
		);
		expect(daySentence(at('2026-12-13'))).toBe(
			'Sun 13 Dec: this kitchen takes no deliveries on Sundays.'
		);
		expect(daySentence(at('2026-12-07'))).toBe('Mon 7 Dec: ordering closed Sun 6 Dec, 17:00.');
	});

	it('reads marks as lines', () => {
		const decide = at('2026-12-08').marks.find((m) => m.kind === 'decision')!;
		expect(markLine(decide)).toBe('Decide before Tue 8 Dec, 15:00: New product (7 lines)');
		const fest = at('2026-12-11').marks.find((m) => m.kind === 'festivity')!;
		expect(markLine(fest)).toBe('Pikkujoulu weekends: +10% bistro guests (team estimate)');
	});

	it('lays days out in Monday-first weeks', () => {
		const weeks = weeksOf(days);
		expect(weeks).toHaveLength(3);
		expect(weeks[0][0]?.date).toBe('2026-12-07');
		expect(weeksOf(days.slice(2))[0].slice(0, 2)).toEqual([null, null]);
	});

	it('steps months and gives their ranges', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2027-01', -1)).toBe('2026-12');
		expect(monthRange('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
	});
});
