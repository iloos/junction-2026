import { describe, expect, it } from 'vitest';
import {
	buildCalendar,
	easter,
	finnishHolidays,
	fold,
	helsinkiLocal,
	holidaysIn
} from './calendar';

const ics = buildCalendar({
	kitchen: { id: 'k-hotel', name: 'Hotel Rautatientori', deliveryDays: ['mon', 'wed', 'fri'] },
	decisions: [
		{
			key: 'ap-1:New product',
			title: 'New product (7 lines), Hotel Rautatientori',
			detail:
				'If you keep them held, these 7 lines are not ordered; Christmas ham loses that cover.',
			due: '2026-12-09T15:00:00.000Z'
		}
	],
	deliveries: [
		{ planId: 'pl-run-1-abc', date: '2026-12-10', title: 'Christmas buffet for 140, 21 lines' }
	],
	window: { from: '2026-12-01', to: '2027-01-31' },
	stamp: '2026-12-07T19:40:00.000Z'
});
const lines = ics.split('\r\n');
/** Content lines with folding undone. */
const unfolded = ics.replace(/\r\n /g, '').split('\r\n');

describe('kitchen calendar feed', () => {
	it('is a well-formed iCalendar document', () => {
		expect(ics.endsWith('\r\n')).toBe(true);
		expect(lines[0]).toBe('BEGIN:VCALENDAR');
		expect(unfolded).toContain('VERSION:2.0');
		expect(unfolded.filter(Boolean).at(-1)).toBe('END:VCALENDAR');
		// Every line ends in CRLF, and none is longer than 75 octets.
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
		// Balanced components; every event has UID, DTSTAMP, DTSTART and SUMMARY.
		const begins = unfolded.filter((l) => l === 'BEGIN:VEVENT').length;
		expect(unfolded.filter((l) => l === 'END:VEVENT').length).toBe(begins);
		const events = ics.replace(/\r\n /g, '').split('BEGIN:VEVENT').slice(1);
		for (const e of events) {
			expect(e).toMatch(/\r\nUID:[^\r\n]+@mandate\.kitchen\r\n/);
			expect(e).toMatch(/\r\nDTSTAMP:20261207T194000Z\r\n/);
			expect(e).toMatch(/\r\nDTSTART[;:]/);
			expect(e).toMatch(/\r\nSUMMARY:/);
		}
		const uids = unfolded.filter((l) => l.startsWith('UID:'));
		expect(new Set(uids).size).toBe(uids.length);
	});

	it('puts the decision at its due time in Helsinki, and the delivery and receiving days as all-day events', () => {
		expect(unfolded).toContain('DTSTART;TZID=Europe/Helsinki:20261209T170000');
		expect(unfolded).toContain(
			String.raw`SUMMARY:Decide before this: New product (7 lines)\, Hotel Rautatientori`
		);
		expect(unfolded).toContain('UID:delivery.k-hotel.pl-run-1-abc@mandate.kitchen');
		expect(unfolded).toContain('DTSTART;VALUE=DATE:20261210');
		expect(unfolded).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270131');
		expect(ics).toContain('BEGIN:VTIMEZONE');
	});

	it('labels holidays as possibly shifting deliveries, never as Valio’s schedule', () => {
		expect(unfolded).toContain(
			String.raw`SUMMARY:Independence Day (Itsenäisyyspäivä)\, public holiday`
		);
		expect(unfolded).toContain(
			String.raw`DESCRIPTION:Public holiday: deliveries may shift\; check Valio's dates.`
		);
		expect(unfolded.some((l) => l.startsWith('SUMMARY:Pikkujoulu season'))).toBe(true);
		expect(unfolded.some((l) => l.includes('Loppiainen'))).toBe(true);
		expect(unfolded).toContain(String.raw`SUMMARY:Christmas Eve (Jouluaatto)\, eve`);
	});

	it('computes the moving holidays', () => {
		expect(easter(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
		const y2027 = Object.fromEntries(finnishHolidays(2027).map((h) => [h.fi, h.date]));
		expect(y2027['Juhannusaatto']).toBe('2027-06-25');
		expect(y2027['Helatorstai']).toBe('2027-05-06');
		expect(y2027['Pyhäinpäivä']).toBe('2027-11-06');
		expect(holidaysIn('2026-12-01', '2026-12-31').map((h) => h.fi)).toContain('Pikkujoulukausi');
	});

	it('folds by octets and reads Helsinki wall time across DST', () => {
		const long = 'X'.repeat(70) + 'ääää';
		expect(
			fold(long)
				.split('\r\n ')
				.every((p) => new TextEncoder().encode(p).length <= 75)
		).toBe(true);
		expect(helsinkiLocal('2027-06-01T09:00:00Z')).toBe('20270601T120000');
		expect(helsinkiLocal('2027-01-01T09:00:00Z')).toBe('20270101T110000');
	});
});
