/**
 * A kitchen's calendar feed (iCalendar, RFC 5545): when each open decision must be made, each plan's delivery
 * date, the kitchen's receiving days, and Finnish public holidays and festive seasons in the window. Holidays
 * are a static list: they say deliveries may shift, never what Valio's schedule is. Pure: no clock, no I/O.
 */

import { LEAD_DAYS } from './scenario';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CalendarInput {
	kitchen: { id: string; name: string; deliveryDays: Weekday[] };
	/** Open decisions with their due time (ISO, from `decisionsDue`). */
	decisions: { key: string; title: string; detail?: string; due: string }[];
	/** Plans and the day they are delivered (YYYY-MM-DD). */
	deliveries: { planId: string; date: string; title: string }[];
	/** Days the feed covers (YYYY-MM-DD, inclusive): holidays and receiving days are listed inside it. */
	window: { from: string; to: string };
	/** DTSTAMP for every event (ISO): when the feed was produced. */
	stamp: string;
	/** Demand factors (calendar-factors.json): events and school holidays are listed as festivities. */
	factors?: DayFactor[];
}

export interface Holiday {
	/** YYYY-MM-DD; a season also has `until`. */
	date: string;
	until?: string;
	name: string;
	fi: string;
	/** An eve is not an official holiday, but most shops and kitchens close early. */
	kind: 'public_holiday' | 'eve' | 'season';
}

const TZ = 'Europe/Helsinki';
const DOMAIN = 'mandate.kitchen';
const HOLIDAY_NOTE = "Public holiday: deliveries may shift; check Valio's dates.";
const EVE_NOTE =
	"Not an official holiday, but most businesses close early: deliveries may shift; check Valio's dates.";
const SEASON_NOTE = "Festive season: busier kitchens; deliveries may shift; check Valio's dates.";

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Easter Sunday (Gregorian, the anonymous algorithm). */
export function easter(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return utc(year, month, day);
}

/** The first `weekday` (0 = Sunday) on or after a date. */
function onOrAfter(d: Date, weekday: number): Date {
	return addDays(d, (weekday - d.getUTCDay() + 7) % 7);
}

/** Finnish public holidays and the pikkujoulu season of one year. */
export function finnishHolidays(year: number): Holiday[] {
	const e = easter(year);
	const day = (
		d: Date,
		name: string,
		fi: string,
		kind: Holiday['kind'] = 'public_holiday'
	): Holiday => ({
		date: ymd(d),
		name,
		fi,
		kind
	});
	return [
		day(utc(year, 1, 1), "New Year's Day", 'Uudenvuodenpäivä'),
		day(utc(year, 1, 6), 'Epiphany', 'Loppiainen'),
		day(addDays(e, -2), 'Good Friday', 'Pitkäperjantai'),
		day(e, 'Easter Sunday', 'Pääsiäispäivä'),
		day(addDays(e, 1), 'Easter Monday', '2. pääsiäispäivä'),
		day(utc(year, 5, 1), 'May Day', 'Vappu'),
		day(addDays(e, 39), 'Ascension Day', 'Helatorstai'),
		day(addDays(e, 49), 'Whitsun', 'Helluntaipäivä'),
		day(onOrAfter(utc(year, 6, 19), 5), 'Midsummer Eve', 'Juhannusaatto', 'eve'),
		day(onOrAfter(utc(year, 6, 20), 6), 'Midsummer Day', 'Juhannuspäivä'),
		day(onOrAfter(utc(year, 10, 31), 6), "All Saints' Day", 'Pyhäinpäivä'),
		{
			date: ymd(utc(year, 11, 15)),
			until: ymd(utc(year, 12, 15)),
			name: 'Pikkujoulu season',
			fi: 'Pikkujoulukausi',
			kind: 'season'
		},
		day(utc(year, 12, 6), 'Independence Day', 'Itsenäisyyspäivä'),
		day(utc(year, 12, 24), 'Christmas Eve', 'Jouluaatto', 'eve'),
		day(utc(year, 12, 25), 'Christmas Day', 'Joulupäivä'),
		day(utc(year, 12, 26), "St Stephen's Day", 'Tapaninpäivä')
	];
}

/** Holidays touching [from, to] (YYYY-MM-DD, inclusive). */
export function holidaysIn(from: string, to: string): Holiday[] {
	const y0 = Number(from.slice(0, 4));
	const y1 = Number(to.slice(0, 4));
	const out: Holiday[] = [];
	for (let y = y0; y <= y1; y++)
		for (const h of finnishHolidays(y))
			if ((h.until ?? h.date) >= from && h.date <= to) out.push(h);
	return out;
}

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

const enc = new TextEncoder();
/** Fold a content line at 75 octets, never inside a UTF-8 character (RFC 5545 3.1). */
export function fold(line: string): string {
	const parts: string[] = [];
	let cur = '';
	let bytes = 0;
	for (const ch of line) {
		const n = enc.encode(ch).length;
		const limit = parts.length ? 74 : 75; // continuation lines start with a space
		if (bytes + n > limit) {
			parts.push(cur);
			cur = '';
			bytes = 0;
		}
		cur += ch;
		bytes += n;
	}
	parts.push(cur);
	return parts.join('\r\n ');
}

/** Local wall time in Helsinki for an instant, as an iCalendar DATE-TIME ("20261209T170000"). */
export function helsinkiLocal(iso: string): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: TZ,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(new Date(iso))
			.map((p) => [p.type, p.value])
	);
	return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

const dateValue = (d: string) => d.replaceAll('-', '');
const stampValue = (iso: string) =>
	new Date(iso).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const uid = (...parts: string[]) =>
	`${parts.map((p) => p.replace(/[^A-Za-z0-9._-]/g, '-')).join('.')}@${DOMAIN}`;
const BYDAY: Record<Weekday, string> = {
	mon: 'MO',
	tue: 'TU',
	wed: 'WE',
	thu: 'TH',
	fri: 'FR',
	sat: 'SA',
	sun: 'SU'
};

/** Europe/Helsinki: EET, EEST from the last Sunday of March to the last Sunday of October. */
const VTIMEZONE = [
	'BEGIN:VTIMEZONE',
	`TZID:${TZ}`,
	'BEGIN:STANDARD',
	'DTSTART:19701025T040000',
	'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
	'TZOFFSETFROM:+0300',
	'TZOFFSETTO:+0200',
	'TZNAME:EET',
	'END:STANDARD',
	'BEGIN:DAYLIGHT',
	'DTSTART:19700329T030000',
	'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
	'TZOFFSETFROM:+0200',
	'TZOFFSETTO:+0300',
	'TZNAME:EEST',
	'END:DAYLIGHT',
	'END:VTIMEZONE'
];

export function buildCalendar(c: CalendarInput): string {
	const stamp = stampValue(c.stamp);
	const k = c.kitchen;
	const events: string[][] = [];
	const event = (id: string, lines: string[]) =>
		events.push(['BEGIN:VEVENT', `UID:${id}`, `DTSTAMP:${stamp}`, ...lines, 'END:VEVENT']);
	const allDay = (from: string, until = from) => [
		`DTSTART;VALUE=DATE:${dateValue(from)}`,
		`DTEND;VALUE=DATE:${dateValue(ymd(addDays(new Date(`${until}T00:00:00Z`), 1)))}`
	];

	for (const d of c.decisions)
		event(uid('decision', k.id, d.key), [
			`DTSTART;TZID=${TZ}:${helsinkiLocal(d.due)}`,
			'DURATION:PT15M',
			`SUMMARY:${escapeText(`Decide before this: ${d.title}`)}`,
			...(d.detail ? [`DESCRIPTION:${escapeText(d.detail)}`] : []),
			'TRANSP:TRANSPARENT'
		]);
	for (const p of c.deliveries)
		event(uid('delivery', k.id, p.planId), [
			...allDay(p.date),
			`SUMMARY:${escapeText(`Delivery: ${p.title}`)}`,
			'TRANSP:TRANSPARENT'
		]);
	if (k.deliveryDays.length)
		event(uid('receiving', k.id), [
			...allDay(c.window.from),
			`RRULE:FREQ=WEEKLY;BYDAY=${k.deliveryDays.map((d) => BYDAY[d]).join(',')};UNTIL=${dateValue(c.window.to)}`,
			`SUMMARY:${escapeText(`Receiving day at ${k.name}`)}`,
			`DESCRIPTION:${escapeText('The days this kitchen takes deliveries, from its profile.')}`,
			'TRANSP:TRANSPARENT'
		]);
	for (const h of holidaysIn(c.window.from, c.window.to))
		event(uid('holiday', h.date, h.fi), [
			...allDay(h.date, h.until),
			`SUMMARY:${escapeText(`${h.name} (${h.fi}), ${h.kind === 'public_holiday' ? 'public holiday' : h.kind}`)}`,
			`DESCRIPTION:${escapeText(h.kind === 'season' ? SEASON_NOTE : h.kind === 'eve' ? EVE_NOTE : HOLIDAY_NOTE)}`,
			'TRANSP:TRANSPARENT'
		]);

	for (const f of c.factors ?? []) {
		if (f.kind !== 'event' && f.kind !== 'schoolHoliday') continue;
		const days: string[][] = [];
		for (let d = f.from; d <= f.to; d = ymd(addDays(new Date(`${d}T00:00:00Z`), 1)))
			if (
				d >= c.window.from &&
				d <= c.window.to &&
				(!f.weekdays || f.weekdays.includes(weekdayOf(d)))
			)
				days.push(f.weekdays ? [d, d] : [d, f.to > c.window.to ? c.window.to : f.to]);
		const spans = f.weekdays ? days : days.slice(0, 1);
		for (const [from, until] of spans)
			event(uid('factor', f.id, from), [
				...allDay(from, until),
				`SUMMARY:${escapeText(f.name)}`,
				`DESCRIPTION:${escapeText(`${factorDetail(f)}. Deliveries are not affected.`)}`,
				'TRANSP:TRANSPARENT'
			]);
	}

	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Mandate//Kitchen calendar//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeText(`${k.name}: decisions and deliveries`)}`,
		`X-WR-TIMEZONE:${TZ}`,
		...VTIMEZONE,
		...events.flat(),
		'END:VCALENDAR'
	];
	return lines.map(fold).join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------------------------------------------------------
 * Days for a picker: the same facts as the feed, one record per date. Pure: `now` comes in, nothing is read.
 * ------------------------------------------------------------------------------------------------------------- */

export type LogisticModel = keyof typeof LEAD_DAYS;

/** A demand factor from fixtures/seeds/calendar-factors.json (only the fields the picker reads). */
export interface DayFactor {
	id: string;
	name: string;
	kind: string;
	from: string;
	to: string;
	weekdays?: string[];
	value: number;
	valueKind: string;
	appliesTo?: string[];
}

export interface DaysInput extends Pick<CalendarInput, 'kitchen' | 'decisions' | 'deliveries'> {
	/** The scenario's "now" (ISO): cut-offs at or before it have passed. */
	now: string;
	/** Valio's time of day each model's order closes ("HH:MM"); default 17:00. */
	closeTimes?: Partial<Record<LogisticModel, string>>;
	/** Valio's own cut-off for a delivery date and model (an offer's closingTime). Wins over LEAD_DAYS. */
	offerCutoffs?: { date: string; model: LogisticModel; at: string }[];
	/** Days with no delivery beyond the computed public holidays (e.g. the factors file's holiday list). */
	closedDays?: { date: string; name: string }[];
	/** Demand factors; only events and school holidays become marks (months are too broad to help pick a day). */
	factors?: DayFactor[];
	/** The kitchen's own events (a booking, a buffet). */
	events?: { id: string; date: string; title: string }[];
}

export type DayStatus = 'open' | 'stock_only' | 'passed' | 'holiday' | 'not_receiving';

export interface DayMark {
	kind: 'holiday' | 'eve' | 'festivity' | 'event' | 'delivery' | 'decision';
	label: string;
	detail?: string;
	/** A team estimate, not data: the UI says so. */
	estimate?: boolean;
	/** ISO instant, for decisions. */
	at?: string;
}

export interface CalendarDay {
	date: string;
	weekday: Weekday;
	/** The kitchen takes deliveries on this weekday. */
	receiving: boolean;
	/** Whether this day can be a delivery date now; `stock_only` = Terminal's cut-off passed, Stock's has not. */
	status: DayStatus;
	/** Short words for any status but open. */
	reason?: string;
	/** For a holiday on a receiving day: the previous delivery day, which takes its order. */
	movedTo?: string;
	/** When the order for delivery on this day closes, per logistic model (empty when there is no delivery). */
	orderBy: { model: LogisticModel; at: string; passed: boolean }[];
	marks: DayMark[];
}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const shift = (date: string, n: number) => ymd(addDays(new Date(`${date}T00:00:00Z`), n));
const MODELS: LogisticModel[] = ['Stock', 'Terminal'];

/** The instant of a Helsinki wall time ("YYYY-MM-DD", "HH:MM"), as ISO with its offset. */
export function helsinkiInstant(date: string, time: string): string {
	const offset =
		new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
			.formatToParts(new Date(`${date}T12:00:00Z`))
			.find((p) => p.type === 'timeZoneName')
			?.value.replace('GMT', '') || '+02:00';
	return `${date}T${time.slice(0, 5)}:00${offset}`;
}

/** The Helsinki calendar date of an instant. */
export const helsinkiDate = (iso: string) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

const APPLIES: Record<string, string> = {
	breakfastCovers: 'breakfasts',
	lunchCovers: 'lunches',
	bistroCovers: 'bistro guests',
	mealsPerDay: 'meals'
};

function factorDetail(f: DayFactor): string {
	const what = (f.appliesTo ?? []).map((a) => APPLIES[a] ?? a).join(', ') || 'demand';
	const effect =
		f.value === 0
			? `no ${what}`
			: `${f.value > 1 ? '+' : '−'}${Math.round(Math.abs(f.value - 1) * 100)}% ${what}`;
	return f.valueKind === 'estimate' ? `${effect} (team estimate)` : effect;
}

/**
 * One record per date in [from, to] (YYYY-MM-DD, inclusive): whether a delivery can land on it now, when its order
 * closes per logistic model (Valio's offer cut-off where known, else LEAD_DAYS at Valio's time of day), holidays
 * (no delivery; the order moves to the previous delivery day), festivities and the kitchen's own dates.
 */
export function calendarDays(input: DaysInput, from: string, to: string): CalendarDay[] {
	const now = new Date(input.now).getTime();
	const today = helsinkiDate(input.now);
	const receivingDays = new Set(input.kitchen.deliveryDays);
	const holidays = holidaysIn(shift(from, -14), to);
	const closed = new Map<string, string>();
	for (const h of holidays) if (h.kind === 'public_holiday') closed.set(h.date, h.name);
	for (const c of input.closedDays ?? [])
		if (!closed.has(c.date)) closed.set(c.date, c.name.replace(/\s*\(.*\)$/, ''));
	const isDelivery = (d: string) => receivingDays.has(weekdayOf(d)) && !closed.has(d);
	const offer = new Map((input.offerCutoffs ?? []).map((o) => [`${o.date}|${o.model}`, o.at]));
	const festivities = (input.factors ?? []).filter(
		(f) => f.kind === 'event' || f.kind === 'schoolHoliday'
	);

	const out: CalendarDay[] = [];
	for (let date = from; date <= to; date = shift(date, 1)) {
		const weekday = weekdayOf(date);
		const receiving = receivingDays.has(weekday);
		const holidayName = closed.get(date);
		const marks: DayMark[] = [];

		if (holidayName) marks.push({ kind: 'holiday', label: holidayName, detail: 'No delivery' });
		for (const h of holidays)
			if (h.date === date && h.kind === 'eve' && !holidayName)
				marks.push({ kind: 'eve', label: h.name, detail: 'Most places close early' });
		for (const f of festivities)
			if (f.from <= date && date <= f.to && (!f.weekdays || f.weekdays.includes(weekday)))
				marks.push({
					kind: 'festivity',
					label: f.name,
					detail: factorDetail(f),
					...(f.valueKind === 'estimate' ? { estimate: true } : {})
				});
		for (const e of input.events ?? [])
			if (e.date === date) marks.push({ kind: 'event', label: e.title });
		for (const p of input.deliveries)
			if (p.date === date) marks.push({ kind: 'delivery', label: p.title });
		for (const d of input.decisions)
			if (helsinkiDate(d.due) === date)
				marks.push({
					kind: 'decision',
					label: `Decide: ${d.title}`,
					...(d.detail ? { detail: d.detail } : {}),
					at: d.due
				});

		const day: CalendarDay = { date, weekday, receiving, status: 'open', orderBy: [], marks };
		if (!receiving) {
			day.status = 'not_receiving';
			day.reason = 'No delivery';
		} else if (holidayName) {
			day.status = 'holiday';
			day.reason = 'Holiday: no delivery';
			for (let d = shift(date, -1), i = 0; i < 14; d = shift(d, -1), i++)
				if (isDelivery(d)) {
					day.movedTo = d;
					break;
				}
		} else {
			day.orderBy = MODELS.map((model) => {
				const at =
					offer.get(`${date}|${model}`) ??
					helsinkiInstant(shift(date, -LEAD_DAYS[model]), input.closeTimes?.[model] ?? '17:00');
				return { model, at, passed: new Date(at).getTime() <= now };
			});
			const passed = day.orderBy.filter((o) => o.passed).length;
			if (date <= today || passed === day.orderBy.length) {
				day.status = 'passed';
				day.reason = date < today ? 'In the past' : 'Ordering closed';
			} else if (passed) {
				day.status = 'stock_only';
				day.reason = 'Stock items only';
			}
		}
		out.push(day);
	}
	return out;
}
