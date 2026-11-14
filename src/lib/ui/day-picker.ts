/**
 * Words and rules for the day picker (DayPicker.svelte): which days can be picked for a logistic model, the one
 * word a cell shows, and the sentence that explains a day. Pure; the days come from core/calendar.ts.
 */
import type { CalendarDay, DayMark, LogisticModel } from '$lib/core/calendar';
import { day as dayLabel, storyTime } from './format';

export type PickModel = LogisticModel | 'any';

/** Plain words for Valio's logistic models, as the chef reads them. */
export const MODEL_WORDS: Record<LogisticModel, string> = {
	Stock: "Valio's warehouse items",
	Terminal: 'supplier-delivered items'
};

/** A delivery for `model` can still be ordered for this day. */
export function pickable(d: CalendarDay, model: PickModel = 'any'): boolean {
	if (model === 'Terminal') return d.status === 'open';
	return d.status === 'open' || d.status === 'stock_only';
}

/**
 * The one short word a cell shows under its date (≤ 7 characters, so it fits a 48 px cell). An orderable day has
 * none: the plain white cell says it. Only exceptions get a word.
 */
export function cellWord(d: CalendarDay, model: PickModel = 'any'): string {
	if (d.status === 'holiday') return 'Holiday';
	if (d.status === 'not_receiving') return '';
	if (d.status === 'passed') return 'Closed';
	if (d.status === 'stock_only') return model === 'Terminal' ? 'Closed' : 'Stock';
	return '';
}

const WEEKDAY_NAMES: Record<CalendarDay['weekday'], string> = {
	mon: 'Mondays',
	tue: 'Tuesdays',
	wed: 'Wednesdays',
	thu: 'Thursdays',
	fri: 'Fridays',
	sat: 'Saturdays',
	sun: 'Sundays'
};

/** "Order by Tue 8 Dec, 15:00 for supplier-delivered items · Wed 9 Dec, 17:00 for Valio's warehouse items". */
function orderBySentence(d: CalendarDay, model: PickModel): string {
	const open = d.orderBy
		.filter((o) => !o.passed && (model === 'any' || o.model === model))
		.sort((a, b) => a.at.localeCompare(b.at));
	if (!open.length) return '';
	if (open.length === 1 && model !== 'any') return `Order by ${storyTime(open[0].at)}.`;
	return `Order by ${open.map((o) => `${storyTime(o.at)} for ${MODEL_WORDS[o.model]}`).join(' · ')}.`;
}

/** The sentence under the grid for a day: can it take a delivery, by when to order, and why not. */
export function daySentence(d: CalendarDay, model: PickModel = 'any'): string {
	const name = dayLabel(d.date);
	switch (d.status) {
		case 'not_receiving':
			return `${name}: this kitchen takes no deliveries on ${WEEKDAY_NAMES[d.weekday]}.`;
		case 'holiday':
			return `${name}: ${d.marks.find((m) => m.kind === 'holiday')?.label ?? 'public holiday'}, no delivery.${d.movedTo ? ` Its order goes on ${dayLabel(d.movedTo)}.` : ''}`;
		case 'passed': {
			if (d.reason === 'In the past') return `${name} has passed.`;
			const last = d.orderBy
				.map((o) => o.at)
				.sort()
				.at(-1);
			return `${name}: ordering closed${last ? ` ${storyTime(last)}` : ''}.`;
		}
		case 'stock_only': {
			const closed = d.orderBy.find((o) => o.passed);
			if (model === 'Terminal')
				return `${name}: ordering for ${MODEL_WORDS.Terminal} closed${closed ? ` ${storyTime(closed.at)}` : ''}.`;
			return `${name}: ${MODEL_WORDS.Stock} only; ${MODEL_WORDS.Terminal} closed${closed ? ` ${storyTime(closed.at)}` : ''}. ${orderBySentence(d, 'Stock')}`;
		}
		default:
			return `${name}: delivery. ${orderBySentence(d, model)}`;
	}
}

/** A mark as one line: "Decide before Tue 8 Dec, 15:00: New product (7 lines)". */
export function markLine(m: DayMark): string {
	if (m.kind === 'decision')
		return `Decide before ${m.at ? storyTime(m.at) : 'this day'}: ${m.label.replace(/^Decide: /, '')}`;
	if (m.kind === 'delivery') return `Delivery: ${m.label}`;
	return m.detail && m.kind === 'festivity' ? `${m.label}: ${m.detail}` : m.label;
}

/** Days laid out in Monday-first weeks; null pads the first and last week. */
export function weeksOf(days: CalendarDay[]): (CalendarDay | null)[][] {
	if (!days.length) return [];
	const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
	const cells: (CalendarDay | null)[] = [
		...Array(order.indexOf(days[0].weekday)).fill(null),
		...days
	];
	while (cells.length % 7) cells.push(null);
	const weeks: (CalendarDay | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** A month ("YYYY-MM") `n` months later (negative: earlier). */
export function shiftMonth(month: string, n: number): string {
	const d = new Date(`${month}-01T00:00:00Z`);
	d.setUTCMonth(d.getUTCMonth() + n);
	return d.toISOString().slice(0, 7);
}

/** The first and last day of a month ("YYYY-MM") as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
	const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`);
	end.setUTCDate(0);
	return { from: `${month}-01`, to: end.toISOString().slice(0, 10) };
}
