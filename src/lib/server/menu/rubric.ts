/**
 * Acceptance rubric for a menu proposal against its brief. It is the seam a shared reviewer (E) will call or
 * extend: `(brief, proposal, previous?) → issues`. A `block` issue keeps the proposal from being accepted as is;
 * a `warn` is shown to the chef. Every check is deterministic and states what it measured.
 */
import type { Course, EventBrief, MenuProposal } from '$lib/core/contracts';

export interface Issue {
	/** Stable per rule and subject ("diet:lactose-free", "dropped:d-ham"), so a UI can key on it. */
	id: string;
	severity: 'block' | 'warn';
	text: string;
}

/** Courses that are a course of the meal; sides, bread and drinks accompany one. */
const MEAL_COURSES = new Set<Course>([
	'starter',
	'soup',
	'fish',
	'main',
	'dessert',
	'cheese',
	'other'
]);
/** A buffet or canapé menu without a course count still needs this many dishes to feed a room. */
export const MIN_BUFFET_DISHES = 4;
/** Served food per guest across the whole menu, in grams (team estimate for an event meal). */
export const GRAMS_PER_GUEST = { min: 250, max: 1500 } as const;
/** One ingredient above this per guest is almost certainly a unit slip (kg read as g). */
export const MAX_INGREDIENT_G = 400;

/** "vegetarian:6" → "vegetarian": the requirement without its head count. */
export const dietBase = (d: string) => d.split(':')[0].trim().toLowerCase();
const counted = (d: string) => d.includes(':');

export function reviewProposal(
	brief: EventBrief,
	p: MenuProposal,
	previous?: MenuProposal | null
): Issue[] {
	const out: Issue[] = [];
	const block = (id: string, text: string) => out.push({ id, severity: 'block', text });
	const warn = (id: string, text: string) => out.push({ id, severity: 'warn', text });

	// Covers and date: the proposal is for exactly this brief.
	if (p.brief.guests !== brief.guests)
		block('covers', `the menu is for ${p.brief.guests} guests, the brief for ${brief.guests}`);
	if (p.brief.date !== brief.date)
		block('date', `the menu is for ${p.brief.date}, the brief for ${brief.date}`);

	// Courses: every requested course has a dish.
	const meal = p.dishes.filter((d) => !d.course || MEAL_COURSES.has(d.course));
	if (brief.courses !== undefined && meal.length < brief.courses)
		block('courses', `${brief.courses} courses asked, ${meal.length} course dishes proposed`);
	if (
		brief.courses === undefined &&
		(brief.serviceStyle === 'buffet' || brief.serviceStyle === 'canape') &&
		p.dishes.length < MIN_BUFFET_DISHES
	)
		block(
			'dishes',
			`${p.dishes.length} dishes for a ${brief.serviceStyle}: at least ${MIN_BUFFET_DISHES} expected`
		);

	// Explicit requirements survive: kept on the proposal's brief, and met by every dish (or said open).
	const kept = new Set(p.brief.dietary.map((d) => d.toLowerCase()));
	const open = new Set(p.open.map((o) => o.id));
	for (const d of brief.dietary) {
		const base = dietBase(d);
		if (!kept.has(d.toLowerCase())) {
			block(`diet:${base}`, `"${d}" from the brief is missing from the menu's brief`);
			continue;
		}
		const claims = p.dishes.filter((x) => x.claimedCompatible.map(dietBase).includes(base));
		if (counted(d)) {
			if (!claims.length && !open.has(`diet:${base}`))
				block(`diet:${base}`, `"${d}": no dish is offered as ${base}`);
		} else {
			const not = p.dishes.filter((x) => !claims.includes(x));
			if (not.length && !open.has(`diet:${base}`))
				block(
					`diet:${base}`,
					`${base} is a requirement for every dish; not claimed by ${not.map((x) => x.name).join(', ')}`
				);
		}
	}

	// Amounts reconcile: each amount is positive and plausible, the menu's total per guest is a meal.
	let grams = 0;
	for (const dish of p.dishes) {
		if (!dish.ingredients.some((i) => i.amountPerCover > 0))
			block(`amount:${dish.id}`, `${dish.name} has no ingredient with an amount`);
		for (const i of dish.ingredients) {
			if (i.unit === 'g') grams += i.amountPerCover;
			if (i.unit === 'g' && i.amountPerCover > MAX_INGREDIENT_G)
				block(
					`amount:${i.id}`,
					`${i.label}: ${i.amountPerCover} g per guest is more than ${MAX_INGREDIENT_G} g`
				);
			if (i.unresolved !== undefined)
				warn(`unresolved:${i.id}`, `${i.label}: no product yet (${i.unresolved})`);
		}
	}
	if (grams < GRAMS_PER_GUEST.min || grams > GRAMS_PER_GUEST.max)
		warn(
			'grams-per-guest',
			`${Math.round(grams)} g of food per guest; an event meal is usually ${GRAMS_PER_GUEST.min}–${GRAMS_PER_GUEST.max} g`
		);

	// Nothing dropped: a model revision keeps every dish and ingredient id; only the chef removes one.
	if (previous && p.provenance.source !== 'user') {
		const now = new Set(p.dishes.flatMap((d) => [d.id, ...d.ingredients.map((i) => i.id)]));
		for (const d of previous.dishes)
			for (const id of [d.id, ...d.ingredients.map((i) => i.id)])
				if (!now.has(id))
					block(`dropped:${id}`, `${id} was in revision ${previous.revision} and is gone`);
	}
	return out;
}

export const blocks = (issues: Issue[]) => issues.filter((i) => i.severity === 'block');
