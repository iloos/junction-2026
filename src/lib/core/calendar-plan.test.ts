import { describe, expect, it } from 'vitest';
import { buildPlanEvents, decideSummary, googleDecideUrl, type PlanDates } from './calendar';

const dates: PlanDates = {
	kitchen: { id: 'k-hotel', name: 'Hotel Rautatientori' },
	plan: {
		id: 'pl-run-1-abc',
		title: 'Christmas dinner buffet, 140 guests',
		deliverBy: '2026-12-10'
	},
	decide: { due: '2026-12-08T15:00:00+02:00', count: 3 },
	stamp: '2026-12-07T19:40:00.000Z'
};
const lines = buildPlanEvents(dates).replace(/\r\n /g, '').split('\r\n');

describe('a plan as events', () => {
	it('adds a decide-by ending at the deadline, with an alarm 2 h before', () => {
		expect(lines).toContain('DTSTART;TZID=Europe/Helsinki:20261208T144500');
		expect(lines).toContain('DURATION:PT15M');
		expect(lines).toContain(
			'SUMMARY:Decide by: Christmas dinner buffet\\, 140 guests (3 decisions)'
		);
		expect(lines).toContain('TRIGGER:-PT2H');
		expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(1);
	});

	it('adds the delivery as an all-day event', () => {
		expect(lines).toContain('DTSTART;VALUE=DATE:20261210');
		expect(lines).toContain('DTEND;VALUE=DATE:20261211');
		expect(lines).toContain('SUMMARY:Delivery: Christmas dinner buffet\\, 140 guests');
	});

	it('is a file of events, not a subscription', () => {
		expect(lines).toContain('METHOD:PUBLISH');
		expect(lines.some((l) => l.startsWith('X-WR-CALNAME'))).toBe(false);
		expect(lines.slice(lines.indexOf('BEGIN:VEVENT')).some((l) => l.startsWith('RRULE'))).toBe(
			false
		);
		expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
	});

	it('leaves out the decide-by when nothing waits', () => {
		const none = buildPlanEvents({ ...dates, decide: null });
		expect(none).not.toContain('Decide by');
		expect(none.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(googleDecideUrl({ ...dates, decide: null })).toBeNull();
		expect(decideSummary({ ...dates, decide: { due: dates.decide!.due, count: 1 } })).toBe(
			'Decide by: Christmas dinner buffet, 140 guests (1 decision)'
		);
	});

	it("opens Google's add-event form for the deadline", () => {
		const url = new URL(googleDecideUrl(dates, 'https://app.mandate.kitchen/?plan=pl-run-1-abc')!);
		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('dates')).toBe('20261208T124500Z/20261208T130000Z');
		expect(url.searchParams.get('text')).toBe(
			'Decide by: Christmas dinner buffet, 140 guests (3 decisions)'
		);
		expect(url.searchParams.get('details')).toContain('?plan=pl-run-1-abc');
	});
});
