import { describe, expect, it } from 'vitest';
import factors from '../../../fixtures/seeds/calendar-factors.json';
import { buildCalendar, calendarDays, type DaysInput } from './calendar';

const input: DaysInput = {
	kitchen: {
		id: 'k-hotel',
		name: 'Hotel Rautatientori',
		deliveryDays: ['mon', 'tue', 'wed', 'thu', 'fri']
	},
	now: '2026-12-07T21:40:00+02:00',
	closeTimes: { Terminal: '15:00' },
	decisions: [
		{ key: 'ap-1:new', title: 'New product (7 lines)', due: '2026-12-08T15:00:00+02:00' }
	],
	deliveries: [{ planId: 'pl-1', date: '2026-12-10', title: 'Christmas buffet, 21 lines' }],
	events: [
		{ id: 'event-xmas-140', date: '2026-12-12', title: 'Christmas dinner buffet, 140 guests' }
	],
	closedDays: factors.holidays.days,
	factors: factors.factors
};
const days = calendarDays(input, '2026-12-01', '2026-12-31');
const at = (d: string) => days.find((x) => x.date === d)!;

describe('calendarDays', () => {
	it('gives one record per date, inclusive', () => {
		expect(days).toHaveLength(31);
		expect(days[0]).toMatchObject({ date: '2026-12-01', weekday: 'tue' });
	});

	it('marks days the kitchen does not receive', () => {
		expect(at('2026-12-13')).toMatchObject({
			status: 'not_receiving',
			receiving: false,
			orderBy: []
		});
	});

	it('closes past days and days whose every cut-off has passed', () => {
		expect(at('2026-12-07')).toMatchObject({ status: 'passed', reason: 'Ordering closed' });
		expect(at('2026-12-03').reason).toBe('In the past');
		// Tue 8: Stock closed Mon 17:00, before now (Mon 21:40).
		expect(at('2026-12-08').status).toBe('passed');
	});

	it('keeps a day open for Stock when only Terminal has closed', () => {
		// Wed 9: Terminal closed Mon 15:00, Stock closes Tue 17:00.
		const d = at('2026-12-09');
		expect(d.status).toBe('stock_only');
		expect(d.orderBy).toEqual([
			{ model: 'Stock', at: '2026-12-08T17:00:00+02:00', passed: false },
			{ model: 'Terminal', at: '2026-12-07T15:00:00+02:00', passed: true }
		]);
	});

	it('opens the scenario delivery day with the Terminal cut-off on Tue 15:00', () => {
		const d = at('2026-12-10');
		expect(d.status).toBe('open');
		expect(d.orderBy.find((o) => o.model === 'Terminal')?.at).toBe('2026-12-08T15:00:00+02:00');
		expect(d.marks.map((m) => m.kind)).toContain('delivery');
	});

	it("prefers Valio's own cut-off for a date over LEAD_DAYS", () => {
		const [d] = calendarDays(
			{
				...input,
				offerCutoffs: [{ date: '2026-12-11', model: 'Terminal', at: '2026-12-08T12:00:00+02:00' }]
			},
			'2026-12-11',
			'2026-12-11'
		);
		expect(d.orderBy.find((o) => o.model === 'Terminal')?.at).toBe('2026-12-08T12:00:00+02:00');
	});

	it('closes holidays and moves their order to the previous delivery day', () => {
		const xmas = at('2026-12-25');
		expect(xmas).toMatchObject({ status: 'holiday', movedTo: '2026-12-23' });
		expect(xmas.marks[0]).toMatchObject({ kind: 'holiday', label: 'Christmas Day' });
		// Christmas Eve is a no-delivery day in the factors file, not only an eve.
		expect(at('2026-12-24')).toMatchObject({ status: 'holiday', movedTo: '2026-12-23' });
	});

	it('marks festivities on their weekdays, estimates as such', () => {
		const fri = at('2026-12-11').marks.find((m) => m.label === 'Pikkujoulu weekends');
		expect(fri).toMatchObject({ kind: 'festivity', estimate: true });
		expect(fri?.detail).toBe('+10% bistro guests (team estimate)');
		expect(at('2026-12-10').marks.some((m) => m.label === 'Pikkujoulu weekends')).toBe(false);
		expect(at('2026-12-21').marks.find((m) => m.kind === 'festivity')?.detail).toBe('no meals');
	});

	it("puts the kitchen's events and decide-before times on their days", () => {
		expect(at('2026-12-12').marks).toContainEqual({
			kind: 'event',
			label: 'Christmas dinner buffet, 140 guests'
		});
		expect(at('2026-12-08').marks.find((m) => m.kind === 'decision')).toMatchObject({
			label: 'Decide: New product (7 lines)',
			at: '2026-12-08T15:00:00+02:00'
		});
	});
});

describe('buildCalendar with factors', () => {
	it('lists festivities in the feed', () => {
		const ics = buildCalendar({
			kitchen: input.kitchen,
			decisions: [],
			deliveries: [],
			window: { from: '2026-12-01', to: '2026-12-31' },
			stamp: '2026-12-07T19:40:00.000Z',
			factors: factors.factors
		}).replace(/\r\n /g, '');
		expect(ics).toContain('SUMMARY:Pikkujoulu weekends');
		expect(ics).toContain('UID:factor.pikkujoulu-weekends-2026.2026-12-11@mandate.kitchen');
		expect(ics).toContain('SUMMARY:School Christmas break (Helsinki)');
		expect(ics).not.toContain('Slush');
	});
});
