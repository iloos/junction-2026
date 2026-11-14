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
const ISO = new RegExp(String.raw`\b${PREP}(\d{4}-\d{2}-\d{2})\b`, 'i');
/** Finnish day.month. ("16.11." or "16.11.2026"); the trailing dot keeps "1.5 kg" out. */
const FI_NUMERIC = new RegExp(String.raw`\b${PREP}(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)`, 'i');

/** Finds the first delivery-date phrase in `text`. Returns null when there is none. */
export function findDate(text: string, today: string): DateHit | null {
	const iso = text.match(ISO);
	if (iso) return { text: iso[0].trim(), iso: iso[1] };

	const fin = text.match(FI_NUMERIC);
	if (fin) {
		const [, d, m, y] = fin;
		const year = y ? Number(y) : Number(today.slice(0, 4));
		const at = (yy: number) => `${yy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
		const out = !y && at(year) < today ? at(year + 1) : at(year);
		if (!Number.isNaN(new Date(`${out}T12:00:00Z`).getTime()))
			return { text: fin[0].trim(), iso: out };
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
