/**
 * Delivery dates from request words, resolved against the simulator clock's Helsinki date.
 * "by Monday" on a Saturday is the coming Monday; a weekday equal to today means next week, and the
 * request says so instead of guessing silently.
 */

const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_EN_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYS_FI = [
	'sunnuntai',
	'maanantai',
	'tiistai',
	'keskiviikko',
	'torstai',
	'perjantai',
	'lauantai'
];

export interface DateHit {
	/** The words matched in the request, e.g. "by Monday". */
	text: string;
	iso: string;
	note?: string;
	/** Set when the words name a day that does not exist ("2026-02-30"); `iso` is then not usable. */
	invalid?: string;
}

const MONTHS_EN = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];
const MONTHS_FI = [
	'tammikuuta',
	'helmikuuta',
	'maaliskuuta',
	'huhtikuuta',
	'toukokuuta',
	'kesäkuuta',
	'heinäkuuta',
	'elokuuta',
	'syyskuuta',
	'lokakuuta',
	'marraskuuta',
	'joulukuuta'
];

/** True when y-m-d is a real calendar day (no roll-over: 31.11. is not 1.12.). */
export function realDate(iso: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
	const d = new Date(`${iso}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** A day and month without a year: this year, or next year once it has passed. */
function dayMonth(text: string, d: number, m: number, y: number | null, today: string): DateHit {
	const at = (yy: number) => `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	const year = y ?? Number(today.slice(0, 4));
	const iso = y === null && at(year) < today ? at(year + 1) : at(year);
	return realDate(iso) ? { text, iso } : { text, iso, invalid: `"${text}" is not a real date` };
}

/** Helsinki calendar date (YYYY-MM-DD) of an instant. */
export function helsinkiDate(at: Date): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(at);
}

export function addDays(iso: string, n: number): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
	return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function weekdayName(iso: string): string {
	const n = DAYS_EN[weekdayOf(iso)];
	return n[0].toUpperCase() + n.slice(1);
}

function nextWeekday(today: string, dow: number): { iso: string; note?: string } {
	const diff = (dow - weekdayOf(today) + 7) % 7;
	if (diff === 0)
		return {
			iso: addDays(today, 7),
			note: `today is ${weekdayName(today)}; read as next ${weekdayName(today)}`
		};
	return { iso: addDays(today, diff) };
}

const PREP = String.raw`(?:(?:by|for|on|before|until|next)\s+)*`;
const EN_DAY = new RegExp(
	String.raw`\b${PREP}(${DAYS_EN.join('|')}|${DAYS_EN_SHORT.join('|')})\b\.?`,
	'i'
);
const FI_DAY = new RegExp(
	String.raw`(?<![\p{L}])(${DAYS_FI.join('|')})(ksi|hin|na)?(?![\p{L}])`,
	'iu'
);
const RELATIVE: { re: RegExp; days: number }[] = [
	{ re: new RegExp(String.raw`\b${PREP}(tomorrow)\b`, 'i'), days: 1 },
	{ re: new RegExp(String.raw`\b${PREP}(today)\b`, 'i'), days: 0 },
	{ re: /(?<![\p{L}])(ylihuomenna|ylihuomiseksi)(?![\p{L}])/iu, days: 2 },
	{ re: /(?<![\p{L}])(huomenna|huomiseksi|huomiseen)(?![\p{L}])/iu, days: 1 },
	{ re: /(?<![\p{L}])(tänään)(?![\p{L}])/iu, days: 0 }
];
const MON = String.raw`(${MONTHS_EN.join('|')}|${MONTHS_EN.map((m) => m.slice(0, 3)).join('|')})\.?`;
/** "20 December", "20th of Dec", with an optional year. */
const EN_DAY_MONTH = new RegExp(
	String.raw`(?<![\p{L}\d.])${PREP}(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MON}(?:,?\s+(\d{4}))?(?![\p{L}])`,
	'iu'
);
/** "December 20th", with an optional year. */
const EN_MONTH_DAY = new RegExp(
	String.raw`(?<![\p{L}])${PREP}${MON}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\p{L}\d])`,
	'iu'
);
/** "20. joulukuuta" (Finnish ordinal day + partitive month). */
const FI_DAY_MONTH = new RegExp(
	String.raw`(?<![\p{L}\d])(\d{1,2})\.\s*(${MONTHS_FI.join('|')})(?:\s+(\d{4}))?(?![\p{L}])`,
	'iu'
);
const monthIndex = (w: string) => {
	const k = w.toLowerCase().replace(/\.$/, '');
	const i = MONTHS_EN.findIndex((m) => m === k || m.slice(0, 3) === k);
	return i >= 0 ? i + 1 : MONTHS_FI.indexOf(k) + 1;
};
const ISO = new RegExp(String.raw`\b${PREP}(\d{4}-\d{2}-\d{2})\b`, 'i');
/** Finnish day.month. ("16.11." or "16.11.2026"); the trailing dot keeps "1.5 kg" out. */
const FI_NUMERIC = new RegExp(String.raw`\b${PREP}(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)`, 'i');

/** Finds the first delivery-date phrase in `text`. Returns null when there is none. */
export function findDate(text: string, today: string): DateHit | null {
	const iso = text.match(ISO);
	if (iso)
		return realDate(iso[1])
			? { text: iso[0].trim(), iso: iso[1] }
			: { text: iso[0].trim(), iso: iso[1], invalid: `"${iso[1]}" is not a real date` };

	const fin = text.match(FI_NUMERIC);
	if (fin) {
		const [, d, m, y] = fin;
		return dayMonth(fin[0].trim(), Number(d), Number(m), y ? Number(y) : null, today);
	}

	const dm = text.match(EN_DAY_MONTH) ?? text.match(FI_DAY_MONTH);
	if (dm) {
		const [, d, mon, y] = dm;
		return dayMonth(dm[0].trim(), Number(d), monthIndex(mon), y ? Number(y) : null, today);
	}
	const md = text.match(EN_MONTH_DAY);
	if (md) {
		const [, mon, d, y] = md;
		return dayMonth(md[0].trim(), Number(d), monthIndex(mon), y ? Number(y) : null, today);
	}

	for (const r of RELATIVE) {
		const m = text.match(r.re);
		if (m) return { text: m[0].trim(), iso: addDays(today, r.days) };
	}

	const en = text.match(EN_DAY);
	if (en) {
		const word = en[1].toLowerCase();
		const dow = Math.max(DAYS_EN.indexOf(word), DAYS_EN_SHORT.indexOf(word));
		return { text: en[0].trim(), ...nextWeekday(today, dow) };
	}

	const fi = text.match(FI_DAY);
	if (fi) {
		const dow = DAYS_FI.indexOf(fi[1].toLowerCase());
		return { text: fi[0].trim(), ...nextWeekday(today, dow) };
	}
	return null;
}
