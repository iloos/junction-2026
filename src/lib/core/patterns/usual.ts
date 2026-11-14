/**
 * Usual orders (D14): per product, the period it recurs on and how settled it is, read from a kitchen's order
 * history; then the lines a delivery day usually carries. A pattern is derived from the record and recomputed on
 * every read, never stored as truth, and it grants nothing: confirmed, a usual order becomes a plan through the
 * normal plan path (memory-and-tenancy: Patterns layer). Pure: no clock, no I/O.
 *
 * Method, chosen to be explainable in one sentence per line:
 * 1. Per weekday, the weeks between orders. Most products in a kitchen ride a delivery day: "every Tuesday",
 *    or "every other Wednesday" when the gaps are mostly 2 weeks.
 * 2. Otherwise the days between orders: about a month apart on a similar day of the month is monthly; a steady
 *    gap is "every n days". Anything else is occasional.
 * 3. Settledness counts the expected slots in the window and how many had the product ("seen 9 of the last 10
 *    Tuesdays"), with the median quantity and its spread. A slot on which the kitchen ordered nothing at all
 *    (a closed day, a school break) is skipped rather than counted as a miss.
 * An explicit period (per product, or for the whole kitchen) replaces step 1–2 for that product.
 */
import {
	addDays,
	addMonths,
	dayOfMonth,
	daysBetween,
	nearestDeliveryDay,
	ordinal,
	plural,
	shortDate,
	weekdayOf,
	WEEKDAYS,
	dayName,
	type Weekday
} from './dates';

/** One delivered line of a past order. `date` is the delivery date (YYYY-MM-DD). */
export interface HistoryLine {
	productId: string;
	qty: number;
	unit: string;
	date: string;
	/** Where the line came from; seeded lines say "simulated history". */
	source?: string;
}

export type PeriodUnit = 'days' | 'weeks' | 'months';
/** How far back to read: n days, weeks or months. */
export interface HistoryWindow {
	n: number;
	unit: PeriodUnit;
}
export const DEFAULT_WINDOW: HistoryWindow = { n: 12, unit: 'weeks' };
/** The window tops out at about six months: beyond that, history only says how settled a pattern is (D14). */
export const MAX_WINDOW_DAYS = 184;

/** An explicit period ("every 2 weeks") that wins over detection. */
export interface PeriodOverride {
	every: number;
	unit: PeriodUnit;
}
export interface PeriodOverrides {
	/** Applies to every product without its own override. */
	kitchen?: PeriodOverride;
	products?: Record<string, PeriodOverride>;
}

export type Period =
	| { kind: 'weekly'; weekday: Weekday; everyWeeks: number }
	| { kind: 'every_n_days'; days: number }
	| { kind: 'monthly'; day: number; everyMonths: number }
	| { kind: 'irregular' };

/**
 * settled: seen in ≥ 80% of its slots · forming: 50–80% · not_settled: too few slots yet · joined: first seen in the
 * last 4 weeks of a longer history · dropped: missed its last slots after a steady run · occasional: no period.
 */
export type PatternStatus =
	'settled' | 'forming' | 'not_settled' | 'joined' | 'dropped' | 'occasional';

export interface QtyStats {
	/** An observed quantity (the lower median), so it keeps the product's lot step. */
	median: number;
	/** 25th and 75th percentile of the observed quantities. */
	low: number;
	high: number;
	/** (high − low) / median: 0 is the same quantity every time. */
	spread: number;
}

export interface ProductPattern {
	productId: string;
	unit: string;
	period: Period;
	source: 'detected' | 'override';
	status: PatternStatus;
	/** k of n: slots that had the product, of the slots the kitchen was open. */
	seen: { k: number; n: number };
	qty: QtyStats;
	/** 0–1: hit rate × quantity steadiness × enough slots. Shown as a reading, never used to grant anything. */
	score: number;
	firstSeen: string;
	lastSeen: string;
	/** Our words, e.g. "seen 9 of the last 10 Tuesdays". No ISO dates. */
	sentence: string;
}

export interface PatternOptions {
	/** Exclusive end of the history read (the sim's today). */
	asOf: string;
	window?: HistoryWindow;
	overrides?: PeriodOverrides;
}

const JOINED_DAYS = 28;
const MIN_SLOTS = { weekly: 4, every_n_days: 3, monthly: 3 } as const;

/** Days a window covers, capped at MAX_WINDOW_DAYS; and its date range [from, to). */
export function windowRange(asOf: string, w: HistoryWindow = DEFAULT_WINDOW) {
	const n = Math.max(1, Math.floor(w.n));
	let from =
		w.unit === 'days'
			? addDays(asOf, -n)
			: w.unit === 'weeks'
				? addDays(asOf, -7 * n)
				: addMonths(asOf, -n);
	if (daysBetween(from, asOf) > MAX_WINDOW_DAYS) from = addDays(asOf, -MAX_WINDOW_DAYS);
	return { from, to: asOf, days: daysBetween(from, asOf) };
}

interface Series {
	unit: string;
	/** date → summed qty, in date order. */
	perDate: Map<string, number>;
	dates: string[];
}

function prepare(lines: readonly HistoryLine[], from: string, to: string) {
	const byProduct = new Map<string, HistoryLine[]>();
	const kitchenDays = new Set<string>();
	for (const l of lines) {
		if (l.date < from || l.date >= to || !(l.qty > 0)) continue;
		kitchenDays.add(l.date);
		const list = byProduct.get(l.productId) ?? [];
		list.push(l);
		byProduct.set(l.productId, list);
	}
	const series = new Map<string, Series>();
	for (const [pid, list] of byProduct) {
		// One unit per product: the most used one (a product ordered in two units is read in its usual one).
		const units = new Map<string, number>();
		for (const l of list) units.set(l.unit, (units.get(l.unit) ?? 0) + 1);
		const unit = [...units].sort((a, b) => b[1] - a[1])[0][0];
		const perDate = new Map<string, number>();
		for (const l of list)
			if (l.unit === unit) perDate.set(l.date, (perDate.get(l.date) ?? 0) + l.qty);
		const dates = [...perDate.keys()].sort();
		series.set(pid, { unit, perDate: new Map(dates.map((d) => [d, perDate.get(d)!])), dates });
	}
	const days = [...kitchenDays].sort();
	return { series, kitchenDays, kitchenFirst: days[0] ?? null };
}

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor((s.length - 1) / 2)];
};
const rank = (sorted: number[], p: number) =>
	sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

function qtyStats(qtys: number[]): QtyStats {
	if (!qtys.length) return { median: 0, low: 0, high: 0, spread: 0 };
	const s = [...qtys].sort((a, b) => a - b);
	const m = median(s);
	const low = rank(s, 0.25);
	const high = rank(s, 0.75);
	return { median: m, low, high, spread: m > 0 ? round2((high - low) / m) : 0 };
}
const round2 = (x: number) => Math.round(x * 100) / 100;

interface Slot {
	date: string;
	hit: boolean;
	qty: number;
}

/** Evaluate target dates: a slot is closed (skipped) when the kitchen ordered nothing within ±tol of it. */
function evalSlots(targets: string[], tol: number, s: Series, kitchenDays: Set<string>): Slot[] {
	const out: Slot[] = [];
	for (const t of targets) {
		let open = false;
		let best: { d: string; off: number } | null = null;
		for (let off = -tol; off <= tol; off++) {
			const d = addDays(t, off);
			if (kitchenDays.has(d)) open = true;
			if (s.perDate.has(d) && (!best || Math.abs(off) < Math.abs(best.off))) best = { d, off };
		}
		if (!open) continue;
		out.push({ date: t, hit: !!best, qty: best ? s.perDate.get(best.d)! : 0 });
	}
	return out;
}

function stepTargets(start: string, stepDays: number, to: string): string[] {
	const out: string[] = [];
	for (let d = start; d < to; d = addDays(d, stepDays)) out.push(d);
	return out;
}

function monthlyTargets(start: string, day: number, everyMonths: number, to: string): string[] {
	const out: string[] = [];
	// First target: day `day` of start's month (or the month before, if start is past it by more than a few days).
	let t = withDay(start, day);
	if (daysBetween(start, t) < -4) t = withDay(addMonths(start, 1), day);
	for (; t < to; t = withDay(addMonths(t, everyMonths), day)) out.push(t);
	return out;
}
function withDay(date: string, day: number): string {
	const [y, m] = date.split('-').map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

const tolFor = (p: Period) =>
	p.kind === 'every_n_days' ? Math.max(1, Math.round(p.days * 0.2)) : p.kind === 'monthly' ? 4 : 0;

/** The slots a period expects from `start` to `to`. */
function slotsFor(p: Period, start: string, to: string, s: Series, kitchenDays: Set<string>) {
	if (p.kind === 'weekly') {
		let first = start;
		while (weekdayOf(first) !== p.weekday) first = addDays(first, 1);
		return evalSlots(stepTargets(first, 7 * p.everyWeeks, to), 0, s, kitchenDays);
	}
	if (p.kind === 'every_n_days')
		return evalSlots(stepTargets(start, p.days, to), tolFor(p), s, kitchenDays);
	if (p.kind === 'monthly')
		return evalSlots(monthlyTargets(start, p.day, p.everyMonths, to), 4, s, kitchenDays);
	return [];
}

interface Candidate {
	period: Period;
	/** First date the period's slots start from (its first hit). */
	start: string;
	source: 'detected' | 'override';
}

/** Step 1: per-weekday periods. Returns those weekdays that carry a rhythm. */
function weeklyCandidates(s: Series, to: string, kitchenDays: Set<string>): Candidate[] {
	const out: Candidate[] = [];
	for (const w of WEEKDAYS) {
		const hits = s.dates.filter((d) => weekdayOf(d) === w);
		if (hits.length < 2) continue;
		const gaps = hits.slice(1).map((d, i) => Math.round(daysBetween(hits[i], d) / 7));
		const weekly: Period = { kind: 'weekly', weekday: w, everyWeeks: 1 };
		const slots1 = slotsFor(weekly, hits[0], to, s, kitchenDays);
		const rate1 = slots1.filter((x) => x.hit).length / Math.max(1, slots1.length);
		const m = median(gaps);
		const share = m >= 2 ? gaps.filter((g) => g % m === 0).length / gaps.length : 0;
		if (m >= 2 && m <= 4 && share >= 0.7 && rate1 < 0.7)
			out.push({
				period: { kind: 'weekly', weekday: w, everyWeeks: m },
				start: hits[0],
				source: 'detected'
			});
		else if (rate1 >= 0.4) out.push({ period: weekly, start: hits[0], source: 'detected' });
	}
	return out;
}

/** Step 2: one period over all of a product's dates (monthly, every n days), or irregular. */
function globalCandidate(s: Series): Candidate {
	const d = s.dates;
	if (d.length >= 3) {
		const gaps = d.slice(1).map((x, i) => daysBetween(d[i], x));
		const m = median(gaps);
		if (m >= 26 && m <= 35) {
			const doms = d.map(dayOfMonth);
			const md = median(doms);
			if (doms.filter((x) => Math.abs(x - md) <= 4).length / doms.length >= 0.7)
				return {
					period: { kind: 'monthly', day: md, everyMonths: 1 },
					start: d[0],
					source: 'detected'
				};
		}
		const tol = Math.max(1, Math.round(m * 0.2));
		if (m >= 2 && gaps.filter((g) => Math.abs(g - m) <= tol).length / gaps.length >= 0.6)
			return { period: { kind: 'every_n_days', days: m }, start: d[0], source: 'detected' };
	}
	return { period: { kind: 'irregular' }, start: d[0], source: 'detected' };
}

function overrideCandidates(s: Series, o: PeriodOverride): Candidate[] {
	const every = Math.max(1, Math.floor(o.every));
	if (o.unit === 'days')
		return [
			{ period: { kind: 'every_n_days', days: every }, start: s.dates[0], source: 'override' }
		];
	if (o.unit === 'months') {
		const md = median(s.dates.map(dayOfMonth));
		return [
			{
				period: { kind: 'monthly', day: md, everyMonths: every },
				start: s.dates[0],
				source: 'override'
			}
		];
	}
	const counts = new Map<Weekday, string[]>();
	for (const d of s.dates) counts.set(weekdayOf(d), [...(counts.get(weekdayOf(d)) ?? []), d]);
	const ranked = [...counts].sort((a, b) => b[1].length - a[1].length);
	const days = ranked.filter(([, ds]) => ds.length >= 2);
	return (days.length ? days : ranked.slice(0, 1)).map(([w, ds]) => ({
		period: { kind: 'weekly', weekday: w, everyWeeks: every },
		start: ds[0],
		source: 'override'
	}));
}

/** Per-product patterns over the window. A product riding several delivery days has one pattern per weekday. */
export function detectPatterns(lines: readonly HistoryLine[], o: PatternOptions): ProductPattern[] {
	const { from, to } = windowRange(o.asOf, o.window);
	const { series, kitchenDays, kitchenFirst } = prepare(lines, from, to);
	const out: ProductPattern[] = [];
	for (const [pid, s] of series) {
		const override = o.overrides?.products?.[pid] ?? o.overrides?.kitchen;
		let cands: Candidate[];
		if (override) cands = overrideCandidates(s, override);
		else {
			const weekly = weeklyCandidates(s, to, kitchenDays);
			const covered = weekly.reduce(
				(n, c) =>
					n +
					s.dates.filter((d) => c.period.kind === 'weekly' && weekdayOf(d) === c.period.weekday)
						.length,
				0
			);
			cands = weekly.length && covered >= 0.7 * s.dates.length ? weekly : [globalCandidate(s)];
		}
		for (const c of cands) out.push(assess(pid, s, c, to, kitchenDays, kitchenFirst!));
	}
	return out.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
}

function assess(
	productId: string,
	s: Series,
	c: Candidate,
	to: string,
	kitchenDays: Set<string>,
	kitchenFirst: string
): ProductPattern {
	const firstSeen = s.dates[0];
	// A weekday rhythm's own last date, so "every other Tuesday" keeps its phase when the product also comes on Fridays.
	const own =
		c.period.kind === 'weekly'
			? s.dates.filter((d) => c.period.kind === 'weekly' && weekdayOf(d) === c.period.weekday)
			: s.dates;
	const lastSeen = (own.length ? own : s.dates)[(own.length ? own : s.dates).length - 1];
	const base = { productId, unit: s.unit, period: c.period, source: c.source, firstSeen, lastSeen };
	if (c.period.kind === 'irregular') {
		const qty = qtyStats(s.dates.map((d) => s.perDate.get(d)!));
		const n = s.dates.length;
		return {
			...base,
			status: 'occasional',
			seen: { k: n, n },
			qty,
			score: 0,
			sentence: n === 1 ? `once, on ${shortDate(firstSeen)}` : `${n} times, no steady rhythm`
		};
	}
	const slots = slotsFor(c.period, c.start, to, s, kitchenDays);
	const n = slots.length;
	const k = slots.filter((x) => x.hit).length;
	let trailing = 0;
	for (let i = slots.length - 1; i >= 0 && !slots[i].hit; i--) trailing++;
	const qty = qtyStats(slots.filter((x) => x.hit).map((x) => x.qty));
	const min = MIN_SLOTS[c.period.kind];
	const rate = n ? k / n : 0;
	const before = n - trailing;
	const dropped =
		trailing >= (c.period.kind === 'monthly' ? 2 : 3) && before >= 2 && k / before >= 0.5;
	const joined =
		!dropped &&
		daysBetween(firstSeen, to) <= JOINED_DAYS &&
		daysBetween(kitchenFirst, firstSeen) >= 14;
	const status: PatternStatus = dropped
		? 'dropped'
		: joined
			? 'joined'
			: n < min
				? 'not_settled'
				: rate >= 0.8
					? 'settled'
					: rate >= 0.5
						? 'forming'
						: 'occasional';
	const score =
		status === 'dropped' || status === 'occasional'
			? 0
			: round2(rate * (1 - Math.min(0.5, qty.spread / 2)) * Math.min(1, n / min));
	return {
		...base,
		status,
		seen: { k, n },
		qty,
		score,
		sentence: sentenceFor(c, status, k, n, firstSeen, lastSeen)
	};
}

/** "Tuesdays", "Wednesdays (every other week)", "months". */
function slotNoun(p: Period, n: number): string {
	if (p.kind === 'weekly') return n === 1 ? dayName(p.weekday) : plural(p.weekday);
	if (p.kind === 'monthly') return n === 1 ? 'month' : 'months';
	return n === 1 ? 'time' : 'times';
}

/** The rhythm in words: "every Tuesday", "every other Wednesday", "monthly, around the 2nd", "every 10 days". */
export function periodText(p: Period): string {
	if (p.kind === 'weekly')
		return p.everyWeeks === 1
			? `every ${dayName(p.weekday)}`
			: p.everyWeeks === 2
				? `every other ${dayName(p.weekday)}`
				: `every ${p.everyWeeks} weeks on ${dayName(p.weekday)}`;
	if (p.kind === 'monthly')
		return p.everyMonths === 1
			? `monthly, around the ${ordinal(p.day)}`
			: `every ${p.everyMonths} months, around the ${ordinal(p.day)}`;
	if (p.kind === 'every_n_days') return `every ${p.days} days`;
	return 'no steady rhythm';
}

function sentenceFor(
	c: Candidate,
	status: PatternStatus,
	k: number,
	n: number,
	firstSeen: string,
	lastSeen: string
): string {
	const p = c.period;
	const set = c.source === 'override' ? `set to ${periodText(p)}: ` : '';
	const weekly1 = p.kind === 'weekly' && p.everyWeeks === 1;
	const seen = weekly1
		? `seen ${k} of the last ${n} ${slotNoun(p, n)}`
		: `${periodText(p)}: seen ${k} of the last ${n}${p.kind === 'monthly' ? ' months' : ''}`;
	if (status === 'dropped')
		return `${set}dropped: last ordered ${shortDate(lastSeen)}, ${periodText(p)} before that`;
	if (status === 'joined')
		return `${set}joined ${shortDate(firstSeen)}: ${weekly1 ? `on ${k} of ${n} ${slotNoun(p, n)} since` : `${periodText(p)}, seen ${k} of ${n} since`}`;
	if (status === 'not_settled')
		return `${set}not settled yet: seen ${k} ${k === 1 ? 'time' : 'times'} so far (${periodText(p)})`;
	return set + seen;
}

// ---------------------------------------------------------------------------------------------------------------

export interface UsualLine {
	productId: string;
	unit: string;
	/** Suggested quantity: the median observed. */
	qty: number;
	low: number;
	high: number;
	score: number;
	status: 'settled' | 'forming';
	period: Period;
	source: 'detected' | 'override';
	seen: { k: number; n: number };
	lastSeen: string;
	sentence: string;
}

/** A product that joined, dropped or is not settled yet; `dueOnDay` says whether its rhythm lands on this day. */
export interface UsualChange {
	productId: string;
	unit: string;
	qty: number;
	period: Period;
	/** First seen (joined, not settled) or last seen (dropped). */
	date: string;
	dueOnDay: boolean;
	sentence: string;
}

export interface UsualOrder {
	deliveryDate: string;
	weekday: Weekday;
	window: { from: string; to: string; days: number };
	/** Lines this delivery day usually carries, best-settled first. */
	lines: UsualLine[];
	joined: UsualChange[];
	dropped: UsualChange[];
	notSettled: UsualChange[];
	/** False when the kitchen has under 4 weeks of history in the window: nothing is settled yet. */
	settled: boolean;
	sentence: string;
}

export interface UsualOrderInput {
	lines: readonly HistoryLine[];
	/** The delivery day to fill (YYYY-MM-DD). */
	deliveryDate: string;
	/** Exclusive end of the history read; default the delivery date. */
	asOf?: string;
	window?: HistoryWindow;
	/** The kitchen's receiving days: a monthly or every-n-days rhythm lands on the closest one. */
	deliveryDays?: readonly Weekday[];
	overrides?: PeriodOverrides;
}

/** Does this pattern's rhythm land on `date`? */
export function dueOn(
	p: ProductPattern,
	date: string,
	deliveryDays: readonly Weekday[] = []
): boolean {
	const per = p.period;
	if (per.kind === 'irregular') return false;
	if (per.kind === 'weekly') {
		if (weekdayOf(date) !== per.weekday) return false;
		if (per.everyWeeks === 1) return true;
		// Phase from the last time it came on this weekday.
		const gap = daysBetween(p.lastSeen, date);
		return weekdayOf(p.lastSeen) === per.weekday
			? gap > 0 && gap % (7 * per.everyWeeks) === 0
			: true;
	}
	const targets: string[] = [];
	if (per.kind === 'every_n_days')
		for (let t = addDays(p.lastSeen, per.days); t <= addDays(date, 3); t = addDays(t, per.days))
			targets.push(t);
	else
		for (const m of [-1, 0, 1]) {
			const t = withDay(addMonths(withDay(date, 1), m), per.day);
			if (daysBetween(p.lastSeen, t) >= 14) targets.push(t);
		}
	return targets.some((t) => nearestDeliveryDay(t, deliveryDays) === date);
}

/** The usual order for one delivery day. */
export function usualOrder(i: UsualOrderInput): UsualOrder {
	const asOf = i.asOf ?? i.deliveryDate;
	const window = windowRange(asOf, i.window);
	const patterns = detectPatterns(i.lines, { asOf, window: i.window, overrides: i.overrides });
	const days = i.deliveryDays ?? [];
	const kitchenDates = i.lines
		.filter((l) => l.date >= window.from && l.date < window.to)
		.map((l) => l.date)
		.sort();
	const span = kitchenDates.length ? daysBetween(kitchenDates[0], asOf) : 0;
	const settled = span >= 28;

	const lines: UsualLine[] = [];
	const change = (p: ProductPattern, date: string): UsualChange => ({
		productId: p.productId,
		unit: p.unit,
		qty: p.qty.median,
		period: p.period,
		date,
		dueOnDay: dueOn(p, i.deliveryDate, days),
		sentence: p.sentence
	});
	const joined = new Map<string, UsualChange>();
	const dropped = new Map<string, UsualChange>();
	const notSettled = new Map<string, UsualChange>();
	for (const p of patterns) {
		if (p.status === 'settled' || p.status === 'forming') {
			if (settled && dueOn(p, i.deliveryDate, days))
				lines.push({
					productId: p.productId,
					unit: p.unit,
					qty: p.qty.median,
					low: p.qty.low,
					high: p.qty.high,
					score: p.score,
					status: p.status,
					period: p.period,
					source: p.source,
					seen: p.seen,
					lastSeen: p.lastSeen,
					sentence: p.sentence
				});
		} else if (p.status === 'joined') keepDue(joined, change(p, p.firstSeen));
		else if (p.status === 'dropped') keepDue(dropped, change(p, p.lastSeen));
		else if (p.status === 'not_settled' || (!settled && p.status !== 'occasional'))
			keepDue(notSettled, change(p, p.firstSeen));
	}
	// One line per product: a product due on this day by two rhythms keeps the better-settled one.
	const best = new Map<string, UsualLine>();
	for (const l of lines) if (!best.has(l.productId)) best.set(l.productId, l);
	const out = [...best.values()].sort(
		(a, b) => b.score - a.score || a.productId.localeCompare(b.productId)
	);
	for (const id of best.keys()) {
		joined.delete(id);
		dropped.delete(id);
		notSettled.delete(id);
	}
	const weekday = weekdayOf(i.deliveryDate);
	const weeks = Math.round(window.days / 7);
	const nSettled = out.filter((l) => l.status === 'settled').length;
	const sentence = !settled
		? `Not settled yet: ${span} ${span === 1 ? 'day' : 'days'} of history.`
		: out.length
			? `Usual ${dayName(weekday)} order from ${weeks} weeks of history: ${out.length} ${out.length === 1 ? 'line' : 'lines'}, ${nSettled} settled.`
			: `Nothing usually comes on ${plural(weekday)} in the last ${weeks} weeks.`;
	return {
		deliveryDate: i.deliveryDate,
		weekday,
		window,
		lines: out,
		joined: [...joined.values()],
		dropped: [...dropped.values()],
		notSettled: [...notSettled.values()],
		settled,
		sentence
	};
}

/** One entry per product; a rhythm due on this day wins over one that isn't. */
function keepDue(m: Map<string, UsualChange>, c: UsualChange) {
	const prev = m.get(c.productId);
	if (!prev || (!prev.dueOnDay && c.dueOnDay)) m.set(c.productId, c);
}
