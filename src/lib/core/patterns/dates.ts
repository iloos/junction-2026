/** Calendar-date helpers for patterns (YYYY-MM-DD, UTC arithmetic so no timezone can shift a day). Pure. */
import type { Weekday } from '../calendar';

export type { Weekday };

export const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES: Record<Weekday, string> = {
	mon: 'Monday',
	tue: 'Tuesday',
	wed: 'Wednesday',
	thu: 'Thursday',
	fri: 'Friday',
	sat: 'Saturday',
	sun: 'Sunday'
};

const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => iso(ms(date) + n * DAY_MS);
/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS);
export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(ms(date)).getUTCDay()];
export const dayOfMonth = (date: string) => new Date(ms(date)).getUTCDate();

/** The same date `n` calendar months earlier (negative n) or later, clamped to the month's last day. */
export function addMonths(date: string, n: number): string {
	const d = new Date(ms(date));
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth() + n;
	const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return iso(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** "Tue 8 Dec": the on-screen form (no ISO dates outside the System layer). */
export function shortDate(date: string): string {
	const d = new Date(ms(date));
	const wd = WEEKDAYS[d.getUTCDay()];
	return `${wd[0].toUpperCase()}${wd.slice(1)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const dayName = (w: Weekday) => DAY_NAMES[w];
export const plural = (w: Weekday) => `${DAY_NAMES[w]}s`;

/** "2nd", "23rd". */
export function ordinal(n: number): string {
	const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${s}`;
}

/**
 * The receiving day a target date lands on: the target itself if the kitchen receives then, else the closest
 * receiving day within 3 days, earlier first (ordering a day early beats running out). Null if none is that close.
 */
export function nearestDeliveryDay(
	target: string,
	deliveryDays: readonly Weekday[]
): string | null {
	if (!deliveryDays.length) return target;
	for (const off of [0, -1, 1, -2, 2, -3, 3]) {
		const d = addDays(target, off);
		if (deliveryDays.includes(weekdayOf(d))) return d;
	}
	return null;
}

/** The first receiving day strictly after `date`. */
export function nextDeliveryDate(date: string, deliveryDays: readonly Weekday[]): string {
	for (let i = 1; i <= 7; i++) {
		const d = addDays(date, i);
		if (!deliveryDays.length || deliveryDays.includes(weekdayOf(d))) return d;
	}
	return addDays(date, 1);
}
