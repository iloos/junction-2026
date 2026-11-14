/**
 * Ingredients the chef asks the menu to use: "with a peach dessert", "use a peach", "featuring lingonberries". The
 * word and, when the words name one, the course it belongs to. A wish, not a requirement: the menu shows it, and the
 * chef still reviews the menu.
 */

export interface Include {
	/** As typed, singular ("peach"). */
	word: string;
	/** The Finnish catalogue search for it. */
	query: string;
	course: 'starter' | 'soup' | 'main' | 'dessert' | null;
}

const FI: Record<string, string> = {
	peach: 'persikka',
	apple: 'omena',
	pear: 'päärynä',
	plum: 'luumu',
	strawberry: 'mansikka',
	strawberrie: 'mansikka',
	blueberry: 'mustikka',
	blueberrie: 'mustikka',
	lingonberry: 'puolukka',
	lingonberrie: 'puolukka',
	raspberry: 'vadelma',
	raspberrie: 'vadelma',
	cherry: 'kirsikka',
	cherrie: 'kirsikka',
	rhubarb: 'raparperi',
	lemon: 'sitruuna',
	orange: 'appelsiini',
	chocolate: 'suklaa',
	mushroom: 'sieni',
	pumpkin: 'kurpitsa',
	beetroot: 'punajuuri',
	carrot: 'porkkana',
	potato: 'peruna',
	salmon: 'lohi',
	chicken: 'broileri',
	cheese: 'juusto',
	spinach: 'pinaatti',
	tomato: 'tomaatti',
	tomatoe: 'tomaatti'
};

const COURSE: Record<string, Include['course']> = {
	dessert: 'dessert',
	desserts: 'dessert',
	cake: 'dessert',
	pie: 'dessert',
	tart: 'dessert',
	crumble: 'dessert',
	pudding: 'dessert',
	jälkiruoka: 'dessert',
	jälkiruoaksi: 'dessert',
	starter: 'starter',
	starters: 'starter',
	salad: 'starter',
	soup: 'soup',
	keitto: 'soup',
	main: 'main',
	'main course': 'main'
};

/** Words that are never the ingredient ("with a vegetarian main", "use the budget"). */
const NOT =
	/^(a|an|the|some|no|vegetarian|vegan|veggie|meat|gluten|lactose|dairy|nut|budget|menu|dinner|lunch|buffet|guests?|people|course|courses|lot|few|nice|good|light|big|small|seasonal|local|finnish|festive|christmas)$/i;

const singular = (w: string) =>
	w
		.toLowerCase()
		.replace(/(ies)$/, 'y')
		.replace(/s$/, '');

/** The ingredients the words ask the menu to use. */
export function includesIn(text: string): Include[] {
	const out: Include[] = [];
	const add = (raw: string, course: Include['course']) => {
		if (NOT.test(raw)) return;
		const word = singular(raw);
		if (word.length < 3 || out.some((x) => x.word === word)) return;
		out.push({ word, query: FI[word] ?? FI[raw.toLowerCase().replace(/s$/, '')] ?? word, course });
	};
	for (const m of text.matchAll(
		/(?<![\p{L}])(?:with|and)\s+(?:a|an|some)?\s*(\p{L}{3,})\s+(dessert|desserts|cake|pie|tart|crumble|pudding|starter|starters|salad|soup|main course|main)(?![\p{L}])/giu
	))
		add(m[1], COURSE[m[2].toLowerCase()] ?? null);
	for (const m of text.matchAll(
		/(?<![\p{L}])(?:use|using|featuring|include|including|käytä)\s+(?:a|an|some|the)?\s*(\p{L}{3,})/giu
	))
		add(m[1], null);
	return out;
}
