/**
 * Delivery days for a request: which dates can still be ordered at `now`, and why a closed one is closed. One rule
 * for the date control, the cut-off question and the off-day suggestion, so a button that names a day always lands
 * on that day: a date is open for an item when at least one of its usable candidates (deliverable, priced,
 * convertible) still has its cut-off ahead, using the scenario's lead days per logistic model (onScenario).
 */
import type { Offer, Product } from '$lib/core/contracts';
import { addDays, onScenario } from '$lib/core/scenario';
import { day } from '$lib/ui/format';
import type { Conversion } from './convert';
import { closesWords, unpickable } from './lookup';
import { weekdayOf } from './dates';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** One candidate an item could be ordered as, with what decides its cut-off. */
export interface DayCandidate {
	product: Pick<Product, 'productId' | 'nameFi'>;
	offer: Offer | undefined;
	conversion: Conversion | null;
}

export interface DayOption {
	date: string;
	/** The kitchen takes deliveries on this weekday. */
	receiving: boolean;
	/** Ordering for this date is still open for every item. */
	open: boolean;
	/** The binding cut-off (ISO): the latest one among the items' best candidates, the earliest across items. */
	closes: string | null;
	/** Why the date can't be chosen, in words; null when it can. */
	reason: string | null;
}

/** Candidates whose only possible obstacle is the date: deliverable, priced, convertible, enough stock. */
export function usable(cands: readonly DayCandidate[]): DayCandidate[] {
	return cands.filter((c) => !unpickable(c.offer, c.conversion));
}

/** The cut-off for `date` of one offer, from its logistic model. */
export function closesFor(offer: Offer, date: string): string | null {
	return onScenario(offer.availability, date).closingTime;
}

/** Valio's default when no product is known yet: Stock, D-1 at 17:00 Helsinki. */
function stockCutoff(date: string): string {
	return onScenario(
		{
			kind: 'unknown',
			amount: null,
			logisticModel: 'Stock',
			availableDate: date,
			closingTime: null,
			raw: null,
			provenance: { source: 'mandate', at: `${date}T00:00:00Z` }
		} as unknown as Offer['availability'],
		date
	).closingTime!;
}

/**
 * One item on one date: open when any usable candidate's cut-off is still ahead. The reason names the candidate
 * that stayed open longest ("past this product's cut-off (Terminal, 13:30 Tue)").
 */
export function itemOnDate(
	cands: readonly DayCandidate[],
	date: string,
	now: Date
): { open: boolean; closes: string | null; reason: string | null } {
	const u = usable(cands).filter(
		(c) => c.offer!.availability.closingTime || c.offer!.availability.availableDate
	);
	if (!u.length) {
		const closes = stockCutoff(date);
		const open = Date.parse(closes) > now.getTime();
		return {
			open,
			closes,
			reason: open ? null : `past the usual cut-off (Stock, ${closesWords(closes)})`
		};
	}
	let best: { c: DayCandidate; closes: string } | null = null;
	for (const c of u) {
		const closes = closesFor(c.offer!, date);
		if (closes && (!best || closes > best.closes)) best = { c, closes };
	}
	if (!best) return { open: true, closes: null, reason: null };
	const open = Date.parse(best.closes) > now.getTime();
	const model = best.c.offer!.availability.logisticModel ?? 'Stock';
	return {
		open,
		closes: best.closes,
		reason: open
			? null
			: `past ${u.length === 1 ? "this product's" : "every match's"} cut-off (${model}, ${closesWords(best.closes)})`
	};
}

/** The request on one date: every item must be open; the first closed item gives the reason. */
export function dayOption(
	items: readonly (readonly DayCandidate[])[],
	date: string,
	now: Date,
	deliveryDays: readonly string[]
): DayOption {
	const receiving = !deliveryDays.length || deliveryDays.includes(DAY_KEYS[weekdayOf(date)]);
	const per = items.length
		? items.map((c) => itemOnDate(c, date, now))
		: [itemOnDate([], date, now)];
	const closed = per.find((p) => !p.open);
	const closes =
		per
			.map((p) => p.closes)
			.filter((c): c is string => !!c)
			.sort()[0] ?? null;
	return {
		date,
		receiving,
		open: !closed,
		closes,
		reason: closed ? closed.reason : receiving ? null : 'not one of your delivery days'
	};
}

/** The next `n` dates from `from` (inclusive), each with whether it can be ordered and why not. */
export function deliveryDays(
	items: readonly (readonly DayCandidate[])[],
	from: string,
	now: Date,
	deliveryDaysOfKitchen: readonly string[],
	n = 10
): DayOption[] {
	return Array.from({ length: n }, (_, k) =>
		dayOption(items, addDays(from, k), now, deliveryDaysOfKitchen)
	);
}

/**
 * The first date after `after` that is open and, when the kitchen has receiving days, one of them (else the first
 * open date), within two weeks. Null when none.
 */
export function firstOpenDay(
	items: readonly (readonly DayCandidate[])[],
	after: string,
	now: Date,
	deliveryDaysOfKitchen: readonly string[]
): DayOption | null {
	const days = Array.from({ length: 14 }, (_, k) =>
		dayOption(items, addDays(after, k + 1), now, deliveryDaysOfKitchen)
	);
	return days.find((d) => d.open && d.receiving) ?? days.find((d) => d.open) ?? null;
}

/** "Wed 9 Dec is past this product's cut-off (Terminal, 13:30 Mon): earliest Thu 10 Dec." */
export function cutoffSentence(
	date: string,
	reason: string | null,
	earliest: string | null
): string {
	return `${day(date)} is ${reason ?? 'closed for ordering'}: ${earliest ? `earliest ${day(earliest)}` : 'no delivery date in the next two weeks is still open'}.`;
}
