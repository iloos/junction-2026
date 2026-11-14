/**
 * The one scenario clock. The simulator, the kitchen and /ops
 * all read these, so the story is consistent on stage: Monday evening, the cut-off on Tuesday, delivery
 * Thursday, the Christmas buffet on Saturday. Pure: no Svelte, no DOM, no I/O, no reading the wall clock.
 * Terminal (supplier) lead times are not enforced by core, so the demo has one cut-off.
 */
import type { Availability } from './contracts';

export const SCENARIO = {
	/** Simulated "now" when a run starts: Monday evening, when the chef usually redoes the order. */
	start: '2026-12-07T21:40:00+02:00',
	/**
	 * The story's binding "must order by": the earliest cut-off among the event's lines (Terminal, D-2 at Valio's
	 * 15:00). Each line still shows its own (onScenario); this is the one the header and timeline count down to.
	 */
	cutoff: '2026-12-08T15:00:00+02:00',
	/** Delivery date for the event's order. */
	delivery: '2026-12-10',
	/** The Christmas buffet. */
	event: '2026-12-12',
	timeZone: 'Europe/Helsinki'
} as const;

/**
 * A clock that reads SCENARIO.start at the moment the run started and then moves in real time, so ops
 * get distinct timestamps and countdowns tick. The caller passes wall-clock ms; core never reads it.
 */
export function scenarioClock(anchorWallMs: number, start: string = SCENARIO.start) {
	const startMs = new Date(start).getTime();
	return {
		at: (wallMs: number) => new Date(startMs + Math.max(0, wallMs - anchorWallMs))
	};
}

/** Helsinki calendar date (YYYY-MM-DD) of a scenario instant. */
export function scenarioDate(d: Date): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: SCENARIO.timeZone }).format(d);
}

/** Days before delivery that Valio's order closes, by logistic model (Stock from the warehouse, Terminal via supplier). */
export const LEAD_DAYS = { Stock: 1, Terminal: 2 } as const;
const DEFAULT_CLOSE = '17:00:00';

/** UTC offset of Helsinki on a calendar date, as "+02:00". */
function helsinkiOffset(date: string): string {
	const name = new Intl.DateTimeFormat('en-US', {
		timeZone: SCENARIO.timeZone,
		timeZoneName: 'longOffset'
	})
		.formatToParts(new Date(`${date}T12:00:00Z`))
		.find((p) => p.type === 'timeZoneName')?.value;
	return name?.replace('GMT', '') || '+02:00';
}

/** A calendar date `days` later (negative: earlier), in UTC so the local timezone cannot shift it. */
export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/**
 * The delivery date a caller gets when it names none: the scenario's delivery, or, once the clock has moved past
 * it, the first day whose Terminal cut-off (D-2) is still ahead. Never a date whose ordering already closed.
 */
export function defaultDeliverBy(today: string): string {
	const earliest = addDays(today, LEAD_DAYS.Terminal + 1);
	return earliest > SCENARIO.delivery ? earliest : SCENARIO.delivery;
}

/**
 * Cached Valio availability carries the dates of the day it was fetched (November), not the scenario's. Moved
 * onto the delivery date: available on deliverBy, ordering closes LEAD_DAYS before it at Valio's own time of day.
 * The facts (kind, amount, model) stay as Valio gave them, `raw` keeps the original dates, and the provenance says
 * the dates are the scenario's.
 */
export function onScenario(a: Availability, deliverBy: string): Availability {
	if (!a.availableDate && !a.closingTime) return a;
	const lead = LEAD_DAYS[a.logisticModel ?? 'Stock'];
	const day = addDays(deliverBy, -lead);
	const time = a.closingTime?.slice(11, 19) || DEFAULT_CLOSE;
	const was = [
		a.availableDate && `available ${a.availableDate}`,
		a.closingTime && `cut-off ${a.closingTime}`
	]
		.filter(Boolean)
		.join(', ');
	return {
		...a,
		availableDate: a.availableDate ? deliverBy : null,
		closingTime: `${day}T${time}${helsinkiOffset(day)}`,
		provenance: {
			...a.provenance,
			// The earlier note (e.g. Valio's "≥999999 = availability unknown") stays after the date note.
			note: `scenario dates: D-${lead} cut-off for ${a.logisticModel ?? 'Stock'} (Valio cache had ${was})${a.provenance.note ? `; ${a.provenance.note}` : ''}`
		}
	};
}

/**
 * The earliest delivery date still orderable at `now` for a line whose order closes `LEAD_DAYS` before delivery at
 * `closeTime` (Valio's time of day, default 17:00). The date a passed cut-off moves to: never one already closed.
 */
export function earliestDelivery(
	now: Date,
	logisticModel: keyof typeof LEAD_DAYS | null | undefined,
	closeTime: string = DEFAULT_CLOSE
): string {
	const lead = LEAD_DAYS[logisticModel ?? 'Stock'];
	let day = addDays(scenarioDate(now), lead);
	for (let i = 0; i < 30; i++, day = addDays(day, 1)) {
		const closes = addDays(day, -lead);
		if (new Date(`${closes}T${closeTime}${helsinkiOffset(closes)}`).getTime() > now.getTime())
			return day;
	}
	return day;
}
