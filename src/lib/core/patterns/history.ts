/**
 * Simulated order history (D14): the mock has no real history, so each seeded kitchen gets one generated from its
 * profile's rhythm (fixtures/seeds/usual-history.json). Deterministic: every line's draw is seeded by kitchen,
 * product and date, so a date's order stays the same as the sim day moves. Every line is labelled
 * "simulated history"; nothing here is written to the op log or a database. Pure: the caller passes the recipe.
 */
import { addDays, daysBetween, weekdayOf, type Weekday } from './dates';
import type { HistoryLine } from './usual';

export const SIMULATED_HISTORY = 'simulated history';

export interface RecipeItem {
	productId: string;
	name?: string;
	unit: string;
	/** Quantities are whole multiples of this (KG lots of 10, or 1 for pieces). */
	lotStep: number;
	/** Typical quantity per delivery. */
	qty: number;
	/** Weekly on these days. */
	days?: Weekday[];
	/** Or every n weeks on `day`. */
	everyWeeks?: number;
	day?: Weekday;
	/** Or monthly, on the first receiving day on or after this day of the month. */
	monthlyOn?: number;
	/** Or once, on the receiving day on or before this many days before asOf. */
	onceDaysAgo?: number;
	/** Joined: only from this many days before asOf. */
	sinceDaysAgo?: number;
	/** Dropped: only until this many days before asOf. */
	untilDaysAgo?: number;
	note?: string;
}

export interface ProfileRecipe {
	/** σ of the lognormal quantity noise. */
	noise: number;
	/** Chance a due line is skipped. */
	missRate: number;
	/** Quantity factor by weekday (e.g. Friday lower). */
	dayFactor?: Partial<Record<Weekday, number>>;
	/** Closed or reduced periods (inclusive dates); `keep` sets a product's own factor in it. */
	breaks?: {
		from: string;
		to: string;
		factor: number;
		keep?: Record<string, number>;
		why?: string;
	}[];
	items: RecipeItem[];
}

export interface HistoryRecipes {
	label: string;
	weeks: number;
	profiles: Record<string, ProfileRecipe>;
}

export interface SimulatedHistory {
	label: typeof SIMULATED_HISTORY;
	kitchenId: string;
	profile: string;
	from: string;
	to: string;
	lines: HistoryLine[];
}

/** FNV-1a, 32-bit. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
function rng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A fixed Monday the every-n-weeks phase counts from, so the phase never moves with the sim day. */
const PHASE_EPOCH = '2026-01-05';

function due(item: RecipeItem, date: string, asOf: string, days: readonly Weekday[]): boolean {
	const ago = daysBetween(date, asOf);
	if (item.sinceDaysAgo !== undefined && ago > item.sinceDaysAgo) return false;
	if (item.untilDaysAgo !== undefined && ago < item.untilDaysAgo) return false;
	const wd = weekdayOf(date);
	if (item.onceDaysAgo !== undefined) {
		let d = addDays(asOf, -item.onceDaysAgo);
		while (days.length && !days.includes(weekdayOf(d))) d = addDays(d, -1);
		return d === date;
	}
	if (item.monthlyOn !== undefined) {
		const dom = Number(date.slice(8));
		if (dom < item.monthlyOn) return false;
		// The first receiving day on or after the target day.
		for (let back = 1; back <= dom - item.monthlyOn; back++)
			if (!days.length || days.includes(weekdayOf(addDays(date, -back)))) return false;
		return !days.length || days.includes(wd);
	}
	if (item.everyWeeks && item.day)
		return (
			wd === item.day && Math.floor(daysBetween(PHASE_EPOCH, date) / 7) % item.everyWeeks === 0
		);
	return !!item.days?.includes(wd);
}

/**
 * Generate a kitchen's history for the `weeks` before `asOf` (exclusive) on its receiving days. An unknown profile
 * gets an empty history, still labelled.
 */
export function simulateHistory(
	recipes: HistoryRecipes,
	k: { id: string; profile: string; deliveryDays: readonly Weekday[] },
	asOf: string,
	weeks = recipes.weeks
): SimulatedHistory {
	const from = addDays(asOf, -7 * weeks);
	const r = recipes.profiles[k.profile];
	const lines: HistoryLine[] = [];
	if (r)
		for (let date = from; date < asOf; date = addDays(date, 1)) {
			if (k.deliveryDays.length && !k.deliveryDays.includes(weekdayOf(date))) continue;
			const brk = r.breaks?.find((b) => date >= b.from && date <= b.to);
			for (const item of r.items) {
				if (!due(item, date, asOf, k.deliveryDays)) continue;
				const rand = rng(hash(`${k.id}|${item.productId}|${date}`));
				if (rand() < r.missRate && item.onceDaysAgo === undefined) continue;
				const factor =
					(r.dayFactor?.[weekdayOf(date)] ?? 1) *
					(brk ? (brk.keep?.[item.productId] ?? brk.factor) : 1);
				if (factor <= 0) continue;
				// Box–Muller: a standard normal from two uniforms.
				const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
				const raw = item.qty * factor * Math.exp(r.noise * z);
				const qty = Math.max(1, Math.round(raw / item.lotStep)) * item.lotStep;
				lines.push({
					productId: item.productId,
					qty: Math.round(qty * 100) / 100,
					unit: item.unit,
					date,
					source: SIMULATED_HISTORY
				});
			}
		}
	return { label: SIMULATED_HISTORY, kitchenId: k.id, profile: k.profile, from, to: asOf, lines };
}
