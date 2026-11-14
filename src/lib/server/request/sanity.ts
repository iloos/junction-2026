/**
 * A size check before anything is placed: the order against the kitchen's own numbers, never a guess
 * about its usage. Two plain ratios: amount per meal a day, and money against the weekly limit.
 */
import type { Kitchen } from '$lib/core/contracts';
import { hardLimitCents } from '$lib/core/mandate/validate';
import { money, num } from '$lib/ui/format';
import type { LookupItemView } from '$lib/ui/request/types';

/** Most kg or l of one product one order may plausibly need per meal served a day (team estimate). */
export const PER_COVER_LIMIT = 10;
/** An order over this many weeks of the kitchen's weekly limit is flagged. */
export const WEEKLY_MULTIPLE = 2;

/** Meals a day from the kitchen's size: every *Covers figure added up (300 breakfasts + 80 bistro guests). */
export function dailyCovers(k: Kitchen): number {
	return Object.entries(k.size)
		.filter(([key]) => /covers$/i.test(key))
		.reduce((s, [, v]) => s + v, 0);
}

/** The picks' total against the mandate's hard limit (the same rule place_order applies). */
export function hardLimit(
	items: LookupItemView[],
	k: Kitchen
): { totalCents: number; limitCents: number } | null {
	const totalCents = items.reduce((s, it) => {
		const c = it.pick?.conversion;
		return s + (c?.ok ? (it.pick!.offer?.price?.unitCents ?? 0) * c.salesQty : 0);
	}, 0);
	const limitCents = hardLimitCents(k.mandate);
	return totalCents > limitCents ? { totalCents, limitCents } : null;
}

export function sanityWarnings(items: LookupItemView[], k: Kitchen): string[] {
	const out: string[] = [];
	const covers = dailyCovers(k);
	let totalCents = 0;
	for (const it of items) {
		const pick = it.pick;
		if (!pick || !pick.conversion?.ok) continue;
		const unitCents = pick.offer?.price?.unitCents ?? 0;
		totalCents += unitCents * pick.conversion.salesQty;
		const a = pick.amount;
		if (!a || covers <= 0) continue;
		const perCover = a.value / covers;
		if (perCover > PER_COVER_LIMIT)
			out.push(
				`${num(a.value, 0)} ${a.unit} of ${it.item.query} is ${num(perCover, 1)} ${a.unit} per meal a day (${k.name} serves ${num(covers, 0)} meals a day): ${num(perCover / PER_COVER_LIMIT, 1)}× the ${PER_COVER_LIMIT} ${a.unit} per meal we treat as plausible for one order`
			);
	}
	const hard = hardLimit(items, k);
	if (hard)
		out.push(
			`${money(hard.totalCents, { whole: true })} is over this kitchen's ${money(hard.limitCents, { whole: true })} hard limit: no approval can pass it. Raise the mandate first`
		);
	const cap = k.mandate.weeklyCapCents;
	if (cap > 0 && totalCents > cap * WEEKLY_MULTIPLE)
		out.push(
			`${money(totalCents, { whole: true })} is ${num(totalCents / cap, 1)}× your ${money(cap, { whole: true })} weekly limit`
		);
	return out;
}
