/**
 * Shares in a request: "500 pizzas no meat 50%" is 500 servings of a dish, 250 of them meat-free and 250 of any
 * kind. A count with a dish noun ("pizzas", "burgers", "lunches") is servings to plan, never packs to buy, and
 * every share of it ("half", "a third", "40%", "50 of them") with a diet word becomes a counted requirement in the
 * brief's own form ("vegetarian:250"). When the words also allow another reading ("no meat 50%" could be "half the
 * meat"), the likeliest one is proposed as a one-tap question, never a dead end.
 *
 * Pure and deterministic: both doors (/request and the chat) read the same words the same way.
 */

/** A dish noun that makes a count servings. Plural or Finnish partitive; the singular only after a count. */
const DISH_WORDS = String.raw`pizzas?|pizzaa|burgers?|hamburgers?|hampurilaisi\p{L}*|lunch(?:es)?|lounas(?:ta)?|dinners?|breakfasts?|meals?|ateri\p{L}*|portions?|annosta|servings?|plates?|sandwich(?:es)?|wraps?|salads?|soups?|bowls?|tacos?|burritos?|kebabs?|pies?`;

/** Words after a count that make it an amount of a product, not servings ("20 kg pizza flour"). */
const PHYSICAL =
	/^(kg|kilo\p{L}*|g\b|grams?|l\b|litres?|liters?|dl|cl|ml|cases?|packs?|pcs|pieces?|boxes|ltk|ki\b|kpl|bags?|bottles?|cans?|tins?)/iu;
/** A product word next to the dish noun: "pizza dough", "burger buns" are products. */
const PRODUCT_AFTER =
	/^(dough|base|bases|buns?|sauce|cheese|flour|mix|patt(?:y|ies)|pohja\p{L}*|taikina\p{L}*|kastike\p{L}*|sämpylä\p{L}*|juusto\p{L}*|pihvi\p{L}*)(?![\p{L}])/iu;

interface DietWord {
	/** The brief's label ("vegetarian", "gluten-free"). */
	label: string;
	/** What the share is called in a sentence ("meat-free"). */
	say: string;
	re: RegExp;
	/** A negation ("no meat") that could also be a reduction ("half the meat"). */
	reducible?: true;
}

const DIETS: DietWord[] = [
	{
		label: 'vegetarian',
		say: 'meat-free',
		re: /(?<![\p{L}])(no meat|without meat|meat[- ]?free|meatless|ei lihaa|lihaton\p{L}*)(?![\p{L}])/iu,
		reducible: true
	},
	{
		label: 'vegetarian',
		say: 'vegetarian',
		re: /(?<![\p{L}])(vegetarian\p{L}*|veggie\p{L}*|veggy|veg|kasvis\p{L}*)(?![\p{L}])/iu
	},
	{ label: 'vegan', say: 'vegan', re: /(?<![\p{L}])(vegan\p{L}*|vegaan\p{L}*)(?![\p{L}])/iu },
	{
		label: 'gluten-free',
		say: 'gluten-free',
		re: /(?<![\p{L}])(gluten[- ]?free|no gluten|without gluten|gluteeniton\p{L}*|keliaak\p{L}*)(?![\p{L}])/iu
	},
	{
		label: 'lactose-free',
		say: 'lactose-free',
		re: /(?<![\p{L}])(lactose[- ]?free|no lactose|laktoositon\p{L}*)(?![\p{L}])/iu
	},
	{
		label: 'dairy-free',
		say: 'dairy-free',
		re: /(?<![\p{L}])(dairy[- ]?free|no dairy|without dairy|maidoton\p{L}*)(?![\p{L}])/iu
	},
	{
		label: 'no pork',
		say: 'pork-free',
		re: /(?<![\p{L}])(no pork|pork[- ]?free|without pork|sianlihaton\p{L}*)(?![\p{L}])/iu,
		reducible: true
	},
	{ label: 'halal', say: 'halal', re: /(?<![\p{L}])(halal)(?![\p{L}])/iu }
];

/** A share of the total: a fraction, a percentage, or a head count ("50 of them"). */
const SHARE =
	/(?<![\p{L}\d])(?:(\d{1,3}(?:[.,]\d+)?)\s*(?:%|percent|prosent\p{L}*)|(half|puolet|puolikas)|(?:a|one)\s+(third|quarter|fifth|tenth)|(two thirds|three quarters)|(\d)\s*\/\s*(\d{1,2})|(the rest|the others|the remainder|loput)|(\d{1,5})\s+(?:of\s+(?:them|those|these|the\s+\p{L}+)|are|is|should be|as|(?=(?:\p{L}+[- ]?){1,2}\s*(?:[,.;]|$|and\b))))(?![\p{L}])/giu;

const FRACTIONS: Record<string, number> = {
	half: 1 / 2,
	puolet: 1 / 2,
	puolikas: 1 / 2,
	third: 1 / 3,
	quarter: 1 / 4,
	fifth: 1 / 5,
	tenth: 1 / 10,
	'two thirds': 2 / 3,
	'three quarters': 3 / 4
};

export interface SharePart {
	/** Servings in this share. */
	count: number;
	/** The brief's requirement label ("vegetarian"). */
	label: string;
	/** The sentence word ("meat-free"). */
	say: string;
	/** The words the share came from ("no meat 50%"). */
	from: string;
}

export interface SharesRead {
	/** All servings. */
	total: number;
	/** The dish noun as typed, singular ("pizza"). */
	dish: string;
	/** Plural for sentences ("pizzas"). */
	dishes: string;
	/** The counted shares; empty when the words give none. */
	parts: SharePart[];
	/** A diet for every serving ("200 vegan pizzas"): the requirement without a count. */
	all: { label: string; say: string }[];
	/** Servings no share claims ("of any kind"). */
	rest: number;
	/** The reading in one sentence: "250 meat-free and 250 regular pizzas". */
	sentence: string;
	/** Requirements in the brief's form: ["vegetarian:250"]. */
	dietary: string[];
	/** Set when another reading is plausible: propose this one as one tap. */
	ask: { question: string; yes: string; no: string; noValue: string } | null;
}

const singular = (w: string) => {
	const l = w.toLowerCase();
	if (/^lunches$/.test(l)) return 'lunch';
	if (/^sandwiches$/.test(l)) return 'sandwich';
	if (/(pizzaa|lounasta|annosta)$/.test(l)) return l.replace(/(a|ta)$/, '');
	return l.replace(/s$/, '');
};
const plural = (w: string) => (/(ch|sh)$/.test(w) ? `${w}es` : /s$/.test(w) ? w : `${w}s`);

function fractionOf(m: RegExpMatchArray, total: number, claimed: number): number | null {
	if (m[1]) {
		const p = Number(m[1].replace(',', '.'));
		return p > 0 && p <= 100 ? p / 100 : null;
	}
	if (m[2]) return FRACTIONS[m[2].toLowerCase()];
	if (m[3]) return FRACTIONS[m[3].toLowerCase()];
	if (m[4]) return FRACTIONS[m[4].toLowerCase()];
	if (m[5] && m[6]) {
		const f = Number(m[5]) / Number(m[6]);
		return f > 0 && f <= 1 ? f : null;
	}
	if (m[7]) return total > 0 ? Math.max(0, total - claimed) / total : null;
	if (m[8]) {
		const n = Number(m[8]);
		return n > 0 && n <= total ? n / total : null;
	}
	return null;
}

interface Hit {
	index: number;
	end: number;
	text: string;
}

/** The total: the count right before the dish noun ("500 pizzas", "the 80 lunches", "500 x pizza"). */
function totalOf(text: string): { total: number; dish: string; at: Hit } | null {
	const re = new RegExp(
		String.raw`(?<![\p{L}\d.,/])(\d{1,3}(?:[ ,]\d{3})+|\d{1,6})\s*(?:x\s*)?(?:(?:\p{L}+[- ]?){0,2}?\s*)?` +
			`(${DISH_WORDS})(?![\\p{L}])`,
		'giu'
	);
	for (const m of text.matchAll(re)) {
		const n = Number(m[1].replace(/[ ,]/g, ''));
		const before = text.slice(0, m.index).trimEnd();
		const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
		const between = m[0].slice(m[1].length).trim();
		// "for 300 breakfasts" is the cover count of a product order; "20 kg pizza flour" is a product amount.
		if (/(?:^|\s)(?:for|per)$/i.test(before)) continue;
		if (PHYSICAL.test(between) || PRODUCT_AFTER.test(after)) continue;
		if (!Number.isFinite(n) || n < 2) continue;
		// A share word between the count and the dish is not part of the dish ("500 50% pizzas" is not read).
		return {
			total: n,
			dish: singular(m[2]),
			at: { index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }
		};
	}
	return null;
}

const pctOf = (f: number) => Math.round(f * 1000) / 10;

/**
 * The servings and shares the words state, or null when there is no count with a dish noun. Pure; the caller
 * routes a non-null reading to the event brief.
 */
export function readShares(text: string): SharesRead | null {
	const t = totalOf(text);
	if (!t) return null;
	const { total } = t;

	const diets: (Hit & { d: DietWord })[] = [];
	for (const d of DIETS)
		for (const m of text.matchAll(new RegExp(d.re.source, 'giu'))) {
			const index = m.index ?? 0;
			// "veg" inside "no meat, veg" is the same diet as the phrase it follows; first match per span wins.
			if (diets.some((x) => index < x.end && index + m[0].length > x.index)) continue;
			diets.push({ index, end: index + m[0].length, text: m[0], d });
		}
	diets.sort((a, b) => a.index - b.index);

	const shares: (Hit & { m: RegExpMatchArray })[] = [];
	for (const m of text.matchAll(SHARE)) {
		const index = m.index ?? 0;
		// The total itself is not a share ("500 pizzas"), nor is a date or a price.
		if (index < t.at.end && index + m[0].length > t.at.index) continue;
		if (m[8] && Number(m[8]) === total) continue;
		shares.push({ index, end: index + m[0].length, text: m[0], m });
	}

	// Pair each share with the nearest diet word in the same clause; a lone pair pairs across clauses.
	const clause = (i: number) => text.slice(0, i).split(/[,;]|\band\b|\bja\b/i).length;
	const used = new Set<number>();
	const parts: SharePart[] = [];
	let claimed = 0;
	let reducible = false;
	const pairs: { s: (typeof shares)[number]; d: (typeof diets)[number] }[] = [];
	for (const s of shares) {
		const near = diets
			.map((d, k) => ({ d, k, gap: d.index >= s.end ? d.index - s.end : s.index - d.end }))
			.filter(
				(x) =>
					!used.has(x.k) &&
					(clause(x.d.index) === clause(s.index) || (shares.length === 1 && diets.length === 1))
			)
			.sort((a, b) => a.gap - b.gap)[0];
		if (!near) continue;
		used.add(near.k);
		pairs.push({ s, d: near.d });
	}
	// "the rest" is counted last, against what the others claimed.
	pairs.sort((a, b) => Number(!!a.s.m[7]) - Number(!!b.s.m[7]));
	for (const { s, d } of pairs) {
		const f = fractionOf(s.m, total, claimed);
		if (f === null) continue;
		const count = Math.round(total * f);
		if (count <= 0 || claimed + count > total) continue;
		claimed += count;
		const from = text.slice(Math.min(s.index, d.index), Math.max(s.end, d.end)).trim();
		parts.push({ count, label: d.d.label, say: d.d.say, from });
		// "no meat 50%": a bare percentage on a negation can also mean "half the meat".
		if (d.d.reducible && s.m[1] && !/\bof\b/i.test(from)) reducible = true;
	}
	// A diet word no share claims applies to every serving ("200 vegan pizzas").
	const all = diets
		.filter((_, k) => !used.has(k))
		.filter((d, k, a) => a.findIndex((x) => x.d.label === d.d.label) === k)
		.map((d) => ({ label: d.d.label, say: d.d.say }));

	// Merge two shares with the same label ("half veggie, 50 of them meat-free").
	const merged: SharePart[] = [];
	for (const p of parts) {
		const same = merged.find((x) => x.label === p.label);
		if (same) same.count += p.count;
		else merged.push({ ...p });
	}
	const rest = total - claimed;
	const dishes = plural(t.dish);
	const restWord = all.length ? all.map((a) => a.say).join(' and ') : 'regular';
	const bits = [
		...merged.map((p) => `${p.count} ${p.say}`),
		...(merged.length && rest > 0 ? [`${rest} ${restWord}`] : [])
	];
	const sentence = merged.length
		? `${bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}` : bits[0]} ${dishes}`
		: `${total} ${all.length ? `${all.map((a) => a.say).join(' and ')} ` : ''}${dishes}`;
	const dietary = [...merged.map((p) => `${p.label}:${p.count}`), ...all.map((a) => a.label)];
	const red = merged.find((p) => DIETS.some((d) => d.reducible && d.label === p.label)) ?? null;
	const ask =
		reducible && red
			? {
					question: `${sentence}?`,
					yes: `Yes, ${sentence}`,
					no: `No, all ${total} with ${pctOf(red.count / total) === 50 ? 'half' : `${pctOf(1 - red.count / total)}% of`} the ${red.label === 'no pork' ? 'pork' : 'meat'}`,
					noValue: `${pctOf(1 - red.count / total)}% of the usual ${red.label === 'no pork' ? 'pork' : 'meat'}`
				}
			: null;
	return { total, dish: t.dish, dishes, parts: merged, all, rest, sentence, dietary, ask };
}
