/**
 * The one scenario clock (review 01:55, R0-d; dates ruled by the lead). The simulator, the kitchen and /ops
 * all read these, so the story is consistent on stage: Monday evening, the cut-off on Tuesday, delivery
 * Thursday, the Christmas buffet on Saturday. Pure: no Svelte, no DOM, no I/O, no reading the wall clock.
 * Terminal (supplier) lead times are not enforced by core, so the demo has one cut-off.
 */
export const SCENARIO = {
	/** Simulated "now" when a run starts: Monday evening, when the chef usually redoes the order. */
	start: '2026-12-07T21:40:00+02:00',
	/** Order cut-off for the delivery below. */
	cutoff: '2026-12-08T14:00:00+02:00',
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
