/**
 * Words that name a dish with a count ("10000 bolognese pasta") rather than a product with an amount: the chat asks
 * whether to plan the dish (brief → menu → recipe → ingredients) or buy packs. `interpretDish` is the seam for the
 * /request dish reading (lane B); until that is on main, a small local reading stands in with the same shape.
 */
export interface DishReading {
	/** The dish in plain words ("pasta bolognese"). */
	dish: string;
	/** Portions: the bare count the chef gave. */
	portions: number;
	/** A question to ask instead of the default one, when the reading has its own. */
	question?: string;
}

export type InterpretDish = (text: string, ctx: { today: string }) => Promise<DishReading | null>;

/** Dish names a chef types, misspellings included, and how we say them. */
const DISHES: { re: RegExp; name: string }[] = [
	{ re: /\bbol[oa][a-z]{2,6}s[ea]\b/i, name: 'pasta bolognese' },
	{ re: /\blasag+n[ae]\b/i, name: 'lasagne' },
	{ re: /\bcarbonara\b/i, name: 'pasta carbonara' },
	{ re: /\brisott?o\b/i, name: 'risotto' },
	{ re: /\b(lohikeitto|salmon soup)\b/i, name: 'salmon soup' },
	{ re: /\b(karjalanpaisti|karelian stew)\b/i, name: 'Karelian stew' },
	{ re: /\b(lihapul+at|meatbal+s)\b/i, name: 'meatballs' },
	{ re: /\bcurry\b/i, name: 'curry' },
	{ re: /\bchil+i con carne\b/i, name: 'chili con carne' },
	{ re: /\bpaella\b/i, name: 'paella' }
];
/** A unit or pack word after the count makes it an amount of a product, not portions of a dish. */
const UNIT_AFTER =
	/^\s*(kg|kilo|kilos|kilograms?|g|grams?|l|litres?|liters?|dl|ml|pcs|pieces?|kpl|cases?|packs?|pkt|bags?|boxes?|tins?|cans?|jars?|bottles?|ltk|pss)\b/i;

/** The stand-in reading: a bare count and a dish name, nothing else. */
export const localInterpretDish: InterpretDish = async (text) => {
	const dish = DISHES.find((d) => d.re.test(text));
	if (!dish) return null;
	for (const m of text.matchAll(/(\d[\d\s,.]*\d|\d)/g)) {
		const after = text.slice((m.index ?? 0) + m[0].length);
		if (UNIT_AFTER.test(after)) return null;
		const n = Number(m[0].replace(/[\s,]/g, ''));
		if (Number.isInteger(n) && n > 0 && n <= 100_000) return { dish: dish.name, portions: n };
	}
	return null;
};

export const interpretDish: InterpretDish = localInterpretDish;
