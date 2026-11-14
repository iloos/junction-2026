/**
 * A size check before anything is placed: the order against the kitchen's own numbers, never a guess
 * about its usage. Two plain ratios: amount per daily cover, and money against the weekly limit.
 */
import type { Kitchen } from '$lib/core/contracts';
import { money } from '$lib/ui/format';
import type { LookupItemView } from '$lib/ui/request/types';

/** Most kg or l of one product one order may plausibly need per daily cover (team estimate). */
export const PER_COVER_LIMIT = 10;
/** An order over this many weeks of the kitchen's weekly limit is flagged. */
export const WEEKLY_MULTIPLE = 2;

const fmt = (n: number, max = 0) =>
	new Intl.NumberFormat('en-IE', { maximumFractionDigits: max }).format(n);

/** Daily covers from the kitchen's size: every *Covers figure added up (300 breakfast + 80 bistro). */
export function dailyCovers(k: Kitchen): number {
	return Object.entries(k.size)
		.filter(([key]) => /covers$/i.test(key))
		.reduce((s, [, v]) => s + v, 0);
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
				`${fmt(a.value)} ${a.unit} of ${it.item.query} is ${fmt(perCover, 1)} ${a.unit} per daily cover (${k.name} serves ${fmt(covers)} covers a day): ${fmt(perCover / PER_COVER_LIMIT, 1)}× the ${PER_COVER_LIMIT} ${a.unit} per cover we treat as plausible for one order`
			);
	}
	const cap = k.mandate.weeklyCapCents;
	if (cap > 0 && totalCents > cap * WEEKLY_MULTIPLE)
		out.push(
			`${money(totalCents, { whole: true })} is ${fmt(totalCents / cap, 1)}× your ${money(cap, { whole: true })} weekly limit`
		);
	return out;
}
