/**
 * A plan made from a menu names each need "Dish · ingredient" ("Gravlax with dill and rye crisp · salmon fillet").
 * The Kitchen reads it as dishes → ingredients → products: one title for the menu, a heading per dish, the
 * ingredients under it. Pure.
 */

export interface NeedName {
	/** The dish this need is for, or null when the name is not "Dish · ingredient". */
	dish: string | null;
	/** The ingredient (or the whole name). */
	part: string;
}

export function splitNeed(name: string): NeedName {
	const i = name.indexOf(' · ');
	if (i <= 0) return { dish: null, part: name };
	const part = name.slice(i + 3).trim();
	return { dish: name.slice(0, i).trim(), part: part.charAt(0).toUpperCase() + part.slice(1) };
}

/** The dishes in order of first appearance. */
export function menuDishes(names: readonly string[]): string[] {
	return [...new Set(names.map((n) => splitNeed(n).dish).filter((d): d is string => !!d))];
}

/** "Menu, 5 dishes: Gravlax with dill and rye crisp, Green salad and 3 more", or null when it isn't a menu. */
export function menuTitle(names: readonly string[]): string | null {
	const dishes = menuDishes(names);
	if (dishes.length < 2) return null;
	const shown = dishes.slice(0, 2).join(', ');
	const rest = dishes.length - 2;
	return `Menu, ${dishes.length} dishes: ${shown}${rest ? ` and ${rest} more` : ''}`;
}

/** Whether the row at `i` starts a new dish (its heading goes above it). */
export function startsDish(names: readonly string[], i: number): boolean {
	const d = splitNeed(names[i]).dish;
	return !!d && (i === 0 || splitNeed(names[i - 1]).dish !== d);
}
