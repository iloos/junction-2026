/**
 * Substitute candidate retrieval shared by the file and Postgres catalogues, so both return the same pool in the
 * same order. Recall only: ranking, hard constraints and fit are judged later (core/rank, validator, Decide).
 *
 * Candidate modes (`CATALOG_RETRIEVAL`):
 * - `hybrid` (default): Valio's rules, then products whose Finnish/English name shares a content
 *   word with the target (Finnish compound heads count: "palvikinkku" matches "juhlakinkku" on "kinkku"), weighted by
 *   how rare the word is, with small bonuses for the same category and temperature class. A candidate must clear a
 *   minimum match; the same category alone is not enough. Dietary properties the target has (lactose-free,
 *   gluten-free) are kept as a hard filter.
 * - `id` (escape hatch): Valio's rules, then the same category + temperature class + net unit in product-id order.
 *
 * Free-text search (`CATALOG_SEARCH`): `id` (default) is the substring AND match in product-id order; `hybrid` ranks
 * by the same scoring with a minimum match. `resolve()` (menu ingredients) is always hybrid and says why a query
 * stayed unresolved.
 */
import type { Product, ProductId } from '$lib/core/contracts';

export type RetrievalMode = 'id' | 'hybrid';
export type CandidateReason = 'rule' | 'name' | 'category';
export interface Candidate {
	productId: ProductId;
	fromValioRule: boolean;
	reason: CandidateReason;
	/** Retrieval score (hybrid only), for debugging and evals; not a ranking signal for core. */
	score?: number;
}

/** The subset of Product retrieval reads; the Postgres adapter loads only these columns. */
export type RetrievalProduct = Pick<
	Product,
	| 'productId'
	| 'nameFi'
	| 'nameEn'
	| 'brand'
	| 'category'
	| 'categoryGroup'
	| 'temperatureClass'
	| 'isFood'
	| 'freeFrom'
	| 'dataQualityFlags'
> & {
	netUnit?: string;
	/** Allergen record (codes, declared); resolve() reads it so produce without free-from data can meet a diet. */
	allergens?: Pick<Product['allergens'], 'contains' | 'declared'>;
};

const env = (k: string) => (typeof process !== 'undefined' ? process.env?.[k] : undefined);

/** Substitute candidates: hybrid unless `CATALOG_RETRIEVAL=id`. */
export function retrievalModeFromEnv(): RetrievalMode {
	return env('CATALOG_RETRIEVAL') === 'id' ? 'id' : 'hybrid';
}

/**
 * Free-text search: substring unless `CATALOG_SEARCH=hybrid`. The request parser and the routine agent still pick
 * from substring order (their tests pin those picks), so hybrid search is opt-in until they adopt it.
 */
export function searchModeFromEnv(): RetrievalMode {
	return env('CATALOG_SEARCH') === 'hybrid' ? 'hybrid' : 'id';
}

/** A free-text ingredient query resolved against the catalogue, or the reason it could not be. */
export type { Resolution } from '$lib/core/ports';
import type { Resolution } from '$lib/core/ports';

/** Resolution of menu ingredient queries; both catalogue adapters implement it (proposed for the Catalog port). */
export interface Resolver {
	resolve(query: string, opts?: { limit?: number; diet?: string[] }): Promise<Resolution>;
}

const DIET_WORD: Record<string, string> = {
	LACTOSE: 'lactose-free',
	GLUTEN: 'gluten-free',
	VEGETARIAN: 'vegetarian',
	VEGAN: 'vegan'
};

/** Words that describe packaging, grade, origin or trade, not what the product is. */
const STOP = new Set(
	(
		'suomi suomalainen kotimainen fi eu ee se nl be es it de dk pl lt lv fr hollanti espanja ruotsi ' +
		'pss pussi säkki sk rasia irto nippu tlk tölkki prk purkki ltk pkt pakkaus pak ' +
		'kpl x n noin väh ka lk 1lk 2lk luokka filmi naku pesty ' +
		'aimo spl valio pro keittiön ' +
		'ja tai with and of the in for ' +
		'kg g l dl ml cl st'
	).split(/\s+/)
);

const ascii = (s: string) => s.toLowerCase().normalize('NFC');

/** Same thing, different word: synonyms and stems consonant gradation hides (naudan → nauta). */
const SAME: Record<string, string> = {
	broileri: 'kana',
	broilerin: 'kana',
	kanan: 'kana',
	kananpoika: 'kana',
	kananpojan: 'kana',
	chicken: 'kana',
	naudan: 'nauta',
	beef: 'nauta',
	sian: 'sika',
	possu: 'sika',
	porsaan: 'sika',
	porsas: 'sika',
	pork: 'sika',
	lohen: 'lohi',
	salmon: 'lohi',
	spaghetti: 'spagetti',
	spaghettia: 'spagetti',
	spagettia: 'spagetti'
};

/** Words that say a product is processed or flavoured; a candidate adding one the target lacks is a different item. */
const PROCESSED =
	/^(kypsä|kypsennetty|paneroitu|leivitetty|grillattu|tempura|marinoitu|maustettu|savustettu|paahdettu|ruskistettu|uunipaahdettu|friteerattu|kastike|kastikkeessa|maku|maustettu|vanilja|vaniljan|suklaa|kaakao|mansikka|mustikka|vadelma|hunaja|hunajamarinoitu|tandoori|bbq|spicy|chili|valkosipuli|yrtti|kebab|bolognese|lasagne|pizza|piirakka|keitto|laatikko)$/;

/** Content words of a name: lower-case, no numbers/units/pack counts, no brand words, no stop words. */
export function contentWords(name: string, brand?: string): string[] {
	const brandWords = new Set(
		ascii(brand ?? '')
			.split(/[^a-zåäö]+/)
			.filter(Boolean)
	);
	return [
		...new Set(
			ascii(name)
				.split(/[^a-zåäö]+/)
				.filter((w) => w.length >= 3 && !STOP.has(w) && !brandWords.has(w))
				.map(
					(w) =>
						SAME[w] ??
						(w.length >= 6 && /[aeiouyäö]n$/.test(w) && !/t[oö]n$/.test(w) ? w.slice(0, -1) : w)
				)
		)
	];
}

/**
 * Similarity of two words, 0..1. Equal = 1. One is the other's compound head (ends with it, ≥4 chars):
 * 0.8 ("kinkku" ~ "palvikinkku"). Shared ending ≥5 chars (both compounds of the same head): 0.6
 * ("juhlakinkku" ~ "palvikinkku"). Shared start ≥5 chars (inflection: "porsaan" ~ "porsas"): 0.5.
 */
export function wordSim(a: string, b: string): number {
	if (a === b) return 1;
	// The same word in another derivation or inflection: "riistakäristys" ~ "riistakäriste", "kermaa" ~ "kerma".
	const da = derivationStem(a);
	if (da.length >= 5 && da === derivationStem(b)) return 0.9;
	const [s, l] = a.length <= b.length ? [a, b] : [b, a];
	if (s.length >= 4 && l.endsWith(s)) return 0.8;
	// The other compound direction: the word is the modifier ("salaatti" in "salaattisekoitus"), weaker than the head.
	if (s.length >= 5 && l.startsWith(s)) return 0.65;
	// A three-letter compound head still names the kind (meijerivoi is butter), as weaker evidence.
	if (s.length === 3 && l.length >= 6 && l.endsWith(s)) return 0.6;
	let suf = 0;
	while (suf < s.length && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
	if (suf >= 5) return 0.6;
	let pre = 0;
	while (pre < s.length && a[pre] === b[pre]) pre++;
	if (pre >= 5) return 0.5;
	return 0;
}

/** A word without its inflection or derivational ending (-ys/-us/-e, partitive): the stem two forms share. */
const stems = new Map<string, string>();
export function derivationStem(w: string): string {
	let s = stems.get(w);
	if (s === undefined) {
		s = stemOf(w);
		if (stems.size >= 200_000) stems.clear();
		stems.set(w, s);
	}
	return s;
}
function stemOf(w: string): string {
	const b = baseForm(w);
	if (b.length >= 7 && /(ys|us|ös)$/.test(b)) return b.slice(0, -2);
	if (b.length >= 6 && /[^aeiouyäö]e$/.test(b)) return b.slice(0, -1);
	return b;
}

const DIET_KEYS: { flag: string; word: RegExp }[] = [
	{ flag: 'LACTOSE', word: /laktoositon|lactose[- ]free/i },
	{ flag: 'GLUTEN', word: /gluteeniton|gluten[- ]free/i }
];
/**
 * Dietary properties a product promises. For the target only its name counts: meat is naturally "free from" lactose
 * in the data, but that doesn't make a lactose-free requirement; "laktoositon" on the name does. A candidate keeps a
 * property if its name or its free-from data says so.
 */
function dietOf(p: RetrievalProduct, nameOnly: boolean): Set<string> {
	const out = new Set<string>();
	for (const k of DIET_KEYS)
		if ((!nameOnly && p.freeFrom.includes(k.flag)) || k.word.test(`${p.nameFi} ${p.nameEn ?? ''}`))
			out.add(k.flag);
	return out;
}

/** Valio allergen codes that break a diet: milk for lactose-free; gluten cereals for gluten-free. */
const BREAKS: Record<string, string[]> = {
	LACTOSE: ['AM'],
	GLUTEN: ['AW', 'UW', 'GB', 'NR', 'GO', 'AX']
};

/**
 * For a menu ingredient a diet is met by the product's promise (name or free-from data) or by a declared allergen
 * record without the allergen: plain pike-perch is lactose-free though nobody labels it so. No record = not met.
 */
function meetsDiet(p: RetrievalProduct, flag: string): boolean {
	if (dietOf(p, false).has(flag)) return true;
	const a = p.allergens;
	return Boolean(a?.declared && !(BREAKS[flag] ?? []).some((c) => a.contains.includes(c)));
}

/**
 * Compound heads that make a different product from the ingredient: a dish, a spread, a mix ("porkkana-perunaruutu",
 * "luumu-vaniljakiisseli", "kylmäsavulohi tuorejuusto"). A resolve candidate with one the query does not name is out.
 */
const OTHER_PRODUCT =
	/(keitto|laatikko|piirakka|piiras|kastike|kastikkeessa|kiisseli|marmeladi|hillo|jogurtti|juusto|hummus|falafel|pihvi|kiusaus|pulla|pullat|sipsi|terriini|kierre|rieska|leipä|tortilla|panini|majoneesi|salaatti|ruutu|kuutio|sekoitus|seos|mix|pyree|sose|bowl|vuoka|pizza|lasagne|makkara|nakki|lenkki|pasteija|mureke|croquette|kroketti|lastu|muusi|ateria|annos|valmiste|leike|levite|smoothie|mehu|juoma|kakku|leivos|stabilointiaine|sakeuttamisaine|makeutusaine|väriaine|lisäaine|tee|grilleri|pasta|sandwich|wrap|patonki|sämpylä|lettu|keksi|sipsit|puuro|rahka|mousse|vanukas)$/;

/**
 * Every content word of the query is in the candidate: the same word, a compound with it as head or modifier
 * ("kerma" in "kuohukerma", "lohi" in "lohifilee"), or, for a compound query word, its head and its modifier both
 * ("kuhafilee" needs "kuha", not only "filee").
 */
function present(q: string, words: string[]): boolean {
	if (words.some((c) => c === q || (q.length >= 4 && (c.endsWith(q) || c.startsWith(q)))))
		return true;
	return words.some((c) => {
		if (c.length < 4 || !q.endsWith(c)) return false;
		const mod = q.slice(0, -c.length);
		return (
			mod.length >= 3 &&
			words.some((m) => m !== c && (m === mod || m.startsWith(mod) || m.endsWith(mod))) &&
			// Another compound on the same head names the product ("suklaa-päärynäkakku" is a pear cake).
			!words.some((w) => w !== c && w.endsWith(c) && !w.startsWith(mod))
		);
	});
}

/**
 * What kind of food a Valio category is, from its code: the catalogue's own hierarchy (187xx fresh fish and meat,
 * 172xx cured meat, 417xx frozen, 226xx/221xx seasoning, sugar and baking). Used to keep a menu ingredient within
 * its kind: whitefish is never a chicken fillet, vanilla never a sausage.
 */
export type FoodKind = 'fish' | 'poultry' | 'meat' | 'seasoning' | 'other';
export function foodKind(category: string): FoodKind {
	const c = Number(category);
	if ((c >= 18701 && c <= 18708) || (c >= 41720 && c <= 41723)) return 'fish';
	if (c === 18750 || c === 18751 || (c >= 41710 && c <= 41712)) return 'poultry';
	if ((c >= 18710 && c <= 18761) || (c >= 17200 && c <= 17210) || (c >= 41701 && c <= 41705))
		return 'meat';
	// Sugar, salt, baking, spices and spice mixes; not sauces, mustards, pastes or purées (tomato is not a spice).
	if ((c >= 22100 && c <= 22190) || [22600, 22601, 22630, 22640].includes(c)) return 'seasoning';
	return 'other';
}
const ANIMAL = new Set<FoodKind>(['fish', 'poultry', 'meat']);
/** Animal products outside the meat and fish categories: honey (22150) and gelatine (22670) by category, else by name. */
const NOT_VEGAN = /hunaja|liivate|gelatiini|gelatin/i;
/** Diet flags that are about the dish, not a free-from label: no meat or fish (and for vegan, no milk or egg). */
const PLANT_FLAGS = new Set(['VEGETARIAN', 'VEGAN']);
/** Below this retrieval score a resolve candidate is too weak to pin. */
export const MIN_RESOLVE_SCORE = 0.4;

/**
 * A partitive or plural recipe word in its base form, conservatively: "kermaa" → "kerma", "marmeladia" →
 * "marmeladi", "maitoa" → "maito", "lehtitaikinalevyjä" → "lehtitaikinalevy". Anything else is returned as is.
 */
export function baseForm(w: string): string {
	if (w.length < 5) return w;
	if (/[aeiouyäö]j[aä]$/.test(w)) return w.slice(0, -2);
	if (/(aa|ää)$/.test(w)) return w.slice(0, -1);
	if (/[iouye][aä]$/.test(w)) return w.slice(0, -1);
	return w;
}

interface Indexed {
	p: RetrievalProduct;
	words: string[];
}

/** Lazily built word index over the catalogue (document frequency per word). */
/**
 * Words that say how a food is made, kept or sold, not what it is: Finnish participles (paistettu, savustettu,
 * viipaloitu), and form, state and grade words in both languages.
 */
const FORM_WORD =
	/^(?:\w+(?:ttu|tty|ttuja|ttyjä|nut|nyt))$|^(?:pakaste|pakasteet|kypsä|raaka|tuore|premium|vapaa|vapaan|luomu|irto|frozen|froze|fresh|fried|prefried|smoked|sliced|diced|cooked|organic|barn|free|range|pre|kpl|pcs|pkt|ltk|psv|ras|quick)$/;

/**
 * Recipe words the catalogue names differently: a menu's "myskikurpitsa" is sold as butternut or diced squash, a
 * "metsäsieni" (forest mushroom) as chanterelle or funnel chanterelle.
 */
const INGREDIENT_ALIASES: [RegExp, string[]][] = [
	[/myskikurpitsa\S*/, ['myskikurpitsakuutio', 'butternut']],
	[/metsäsien\S*/, ['kantarelli', 'suppilovahvero']]
];

/**
 * Other ways to read a recipe line that found nothing: without the packing liquid ("persikanpuolikkaat
 * sokeriliemessä" is the halves, whatever they are packed in), then the aliases above. "tuore" stays: without it
 * "tuore timjami" finds dried thyme, and unresolved is the honest answer.
 */
export function rewordings(raw: string): string[] {
	const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
	const plain = s
		.replace(/\s\S*(?:liemessä|mehussa|siirapissa|öljyssä|vedessä)(?=\s|$).*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	const out = plain && plain !== s ? [plain] : [];
	for (const [w, alts] of INGREDIENT_ALIASES)
		if (w.test(plain)) for (const a of alts) out.push(plain.replace(w, a));
	return out;
}

const PORTION = /annos|portion|sachet|stick|pussi(?:t|a)?\b/i;
/** Many small units sold together: "500x5g", "4,5g x 800kpl", or a portion word in either name. */
function isPortionPack(p: RetrievalProduct | undefined): boolean {
	if (!p) return false;
	const name = `${p.nameFi} ${p.nameEn ?? ''}`.toLowerCase();
	if (/annospakkaus|annospussi|portion|sachet|stick/.test(name)) return true;
	const many =
		/(\d{2,4})\s*x\s*(\d+(?:[.,]\d+)?)\s*g\b/.exec(name) ??
		/(\d+(?:[.,]\d+)?)\s*g\s*x\s*(\d{2,4})/.exec(name);
	if (!many) return false;
	const [a, b] = [Number(many[1].replace(',', '.')), Number(many[2].replace(',', '.'))];
	const grams = Math.min(a, b);
	const count = Math.max(a, b);
	return grams <= 25 && count >= 20;
}

/**
 * Words a chef types that the catalogue (Finnish names, English translations) does not use: English and colloquial
 * terms to the catalogue's own words. Each entry is a list of alternatives, searched one at a time; a cut ("steak")
 * names beef cuts, never bare "pihvi" (that is also a beef tomato and a burger patty).
 */
export const SEARCH_WORDS: Record<string, string[]> = {
	cow: ['naudan', 'nauta', 'beef'],
	beef: ['naudan', 'nauta', 'beef'],
	cattle: ['naudan', 'nauta'],
	steak: ['naudan pihvi', 'entrecote', 'naudan ulkofile', 'naudan sisäfile', 'steak'],
	sirloin: ['ulkofile', 'sirloin'],
	tenderloin: ['sisäfile', 'tenderloin'],
	pork: ['porsaan', 'sian', 'pork'],
	pig: ['porsaan', 'sian'],
	chicken: ['broileri', 'broilerin', 'kana', 'chicken'],
	hen: ['kana', 'broileri'],
	turkey: ['kalkkuna', 'turkey'],
	lamb: ['lammas', 'karitsa', 'lamb'],
	reindeer: ['poro', 'reindeer'],
	minced: ['jauheliha', 'minced'],
	mince: ['jauheliha', 'minced'],
	ground: ['jauheliha'],
	ham: ['kinkku', 'ham'],
	bacon: ['pekoni', 'bacon'],
	sausage: ['makkara', 'nakki', 'sausage'],
	meat: ['liha', 'meat'],
	fish: ['kala', 'fish'],
	salmon: ['lohi', 'salmon'],
	tuna: ['tonnikala', 'tuna'],
	shrimp: ['katkarapu', 'shrimp'],
	prawn: ['katkarapu', 'prawn'],
	milk: ['maito', 'milk'],
	cream: ['kerma', 'cream'],
	butter: ['voi', 'butter'],
	cheese: ['juusto', 'cheese'],
	egg: ['kananmuna', 'muna', 'egg'],
	yogurt: ['jogurtti', 'yoghurt'],
	yoghurt: ['jogurtti', 'yoghurt'],
	potato: ['peruna', 'potato'],
	carrot: ['porkkana', 'carrot'],
	onion: ['sipuli', 'onion'],
	tomato: ['tomaatti', 'tomato'],
	cucumber: ['kurkku', 'cucumber'],
	lettuce: ['salaatti', 'lettuce'],
	mushroom: ['herkkusieni', 'sieni', 'mushroom'],
	flour: ['vehnäjauho', 'jauho', 'flour'],
	sugar: ['sokeri', 'sugar'],
	salt: ['suola', 'salt'],
	rice: ['riisi', 'rice'],
	pasta: ['pasta', 'makaroni', 'spagetti'],
	bread: ['leipä', 'bread'],
	coffee: ['kahvi', 'coffee'],
	tea: ['tee', 'tea'],
	oil: ['öljy', 'oil'],
	apple: ['omena', 'apple'],
	berries: ['marja', 'berry'],
	strawberry: ['mansikka', 'strawberry'],
	blueberry: ['mustikka', 'blueberry']
};

/** Amounts, units and filler a request carries that are not product words ("100", "2kg", "pcs", "of"). */
const NOT_A_PRODUCT =
	/^(?:\d+(?:[.,]\d+)?(?:kg|g|l|dl|cl|ml|pcs|kpl|x)?|kg|g|l|dl|ml|pcs|kpl|pieces?|of|some|the|a|an|and|please|for|kilo|kilos|litre|litres|liter|liters|pack|packs)$/;

/** Edit distance between two short words, stopping once it passes `max`. */
function editDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			best = Math.min(best, cur[j]);
		}
		if (best > max) return max + 1;
		prev = cur;
	}
	return prev[b.length];
}

/** A tolerant search hit: how sure, and what was searched for. */
export interface ScoredHit {
	productId: ProductId;
	confidence: number;
	readAs: string;
}

export class RetrievalIndex {
	private items: Indexed[];
	private byId = new Map<ProductId, Indexed>();
	private df = new Map<string, number>();
	constructor(products: Iterable<RetrievalProduct>) {
		this.items = [];
		for (const p of products) {
			if (!p.isFood || p.dataQualityFlags.includes('old_flagged_name')) continue;
			const words = contentWords(`${p.nameFi} ${p.nameEn ?? ''}`, p.brand);
			this.items.push({ p, words });
			this.byId.set(p.productId, { p, words });
			for (const w of words) this.df.set(w, (this.df.get(w) ?? 0) + 1);
		}
	}
	private idf(w: string) {
		return Math.log(1 + this.items.length / (1 + (this.df.get(w) ?? 0)));
	}

	private queryTarget(query: string): RetrievalProduct {
		return {
			productId: '',
			nameFi: query,
			category: '',
			categoryGroup: '',
			temperatureClass: 'unknown',
			isFood: true,
			freeFrom: [],
			dataQualityFlags: []
		};
	}

	/**
	 * Products matching a free-text query, best first. Only products that clear the minimum match are returned, so
	 * an empty result means "unresolved", never "take the nearest substring hit" ("voi" is butter, not savoy cabbage).
	 */
	search(query: string, limit: number): ProductId[] {
		return this.similar(this.queryTarget(query), new Set(), limit, { minLex: 0.5 }).map(
			(c) => c.productId
		);
	}

	/**
	 * Search as a chef types: amounts and fillers dropped, English and colloquial words read as the catalogue's
	 * (SEARCH_WORDS), plurals singular, and a typo corrected to the nearest known word (edit distance 1, or 2 for
	 * longer words). Each reading is searched on its own and a product keeps its best score; the confidence is that
	 * score, lowered when a word was corrected.
	 */
	searchTolerant(
		query: string,
		limit: number
	): { hits: ScoredHit[]; readAs: string; corrected?: string } {
		const raw = query
			.toLowerCase()
			.split(/[^a-zåäöéèüô0-9.,]+/)
			.filter((w) => w && !NOT_A_PRODUCT.test(w));
		const fixes: string[] = [];
		// Words neither the catalogue nor the table knows, even after a typo fix ("flurbleberry"): the rest of the
		// query alone ("jam") is a guess, so it is never confident.
		let unread = 0;
		const keys = Object.keys(SEARCH_WORDS);
		const known = (w: string) => SEARCH_WORDS[w] ?? (this.df.has(w) ? [w] : undefined);
		const groups: string[][] = [];
		for (const w0 of raw) {
			const sing = w0.length > 4 && /[^s]s$/.test(w0) ? w0.slice(0, -1) : w0;
			let alts = known(w0) ?? known(sing);
			if (!alts && sing.length >= 4) {
				const max = sing.length >= 7 ? 2 : 1;
				const near = (cands: Iterable<string>) => {
					let best: { w: string; d: number } | undefined;
					for (const c of cands) {
						const d = editDistance(sing, c, max);
						if (d <= max && (!best || d < best.d)) best = { w: c, d };
					}
					return best;
				};
				const hit = near(keys) ?? near([...this.df.keys()].filter((k) => k.length >= 4));
				if (hit) {
					fixes.push(`${w0} → ${hit.w}`);
					alts = known(hit.w);
				}
			}
			if (!alts) unread++;
			groups.push(alts ?? [w0]);
		}
		if (!groups.length) return { hits: [], readAs: '' };
		// One alternative per word, every combination (capped): "cow meat" → "naudan liha", "nauta meat", …
		let combos: string[][] = [[]];
		for (const g of groups) combos = combos.flatMap((c) => g.map((a) => [...c, a])).slice(0, 24);
		const best = new Map<ProductId, ScoredHit>();
		for (const c of combos) {
			const q = c.join(' ');
			for (const r of this.similar(this.queryTarget(q), new Set(), limit, { minLex: 0.5 })) {
				const confidence = Math.max(
					0,
					Math.min(1, (r.score ?? 0) * (fixes.length ? 0.85 : 1) * (unread ? 0.5 : 1))
				);
				const prev = best.get(r.productId);
				if (!prev || confidence > prev.confidence)
					best.set(r.productId, { productId: r.productId, confidence, readAs: q });
			}
		}
		const hits = [...best.values()]
			.sort((a, b) => b.confidence - a.confidence || (a.productId < b.productId ? -1 : 1))
			.slice(0, limit)
			.map((h) => ({ ...h, confidence: Math.round(h.confidence * 100) / 100 }));
		return {
			hits,
			readAs: groups.map((g) => g.join('/')).join(' '),
			...(fixes.length ? { corrected: fixes.join(', ') } : {})
		};
	}

	/**
	 * Resolve an ingredient query. Dietary requirements come from the query's words ("laktoositon kerma") and from
	 * `diet` (e.g. ['LACTOSE'] for a lactose-free menu). Unresolved results say which bar was not cleared.
	 */
	resolve(raw: string, o: { limit?: number; diet?: string[] } = {}): Resolution {
		const first = this.resolveOne(raw, o);
		if (first.status === 'resolved') return first;
		// A recipe's wording the catalogue doesn't use: tried only when the line as written finds nothing, each through
		// the same diet and guard, so a rewording never loosens what the line must meet.
		for (const alt of rewordings(raw)) {
			const r = this.resolveOne(alt, o);
			if (r.status === 'resolved') return r;
		}
		return first;
	}

	private resolveOne(raw: string, o: { limit?: number; diet?: string[] }): Resolution {
		// A recipe line reads as its ingredient: notes in brackets go; of alternatives the named one stays ("voi tai
		// margariini" is butter; the prefix form "vispi- tai kuohukermaa" is the full word, kuohukerma); plural fillets
		// read as the fillet ("kirjolohifileet"). Quantities and units are not content words anyway.
		const query = raw
			.replace(/\([^)]*\)/g, ' ')
			.replace(/\S+-\s+tai\s+/gi, '')
			.replace(/\s+tai\s+\S+/gi, '')
			.replace(/fileet(?![a-zåäö])/gi, 'filee')
			.replace(/\s+/g, ' ')
			.trim();
		const t = this.queryTarget(query);
		const limit = o.limit ?? 5;
		if (contentWords(query).length === 0)
			return {
				status: 'unresolved',
				query,
				reason: 'the query has no product words (only sizes, origins or brand words)',
				nearest: []
			};
		const all = new Set([...dietOf(t, true), ...(o.diet ?? [])]);
		const plant = [...all].filter((f) => PLANT_FLAGS.has(f));
		const diet = new Set([...all].filter((f) => !PLANT_FLAGS.has(f)));
		const pool = this.similar(t, new Set(), 60, { minLex: 0.5, diet, strict: true });
		const guarded = this.guard(query, pool, plant, [...diet]);
		// An ingredient for a kitchen is bought in kitchen packs: portion sachets (500 × 5 g) go after them, unless the
		// query asks for portions. A stable sort, so the score order holds within each group.
		const wantsPortions = PORTION.test(query);
		const kept = wantsPortions
			? guarded.kept
			: [...guarded.kept].sort(
					(a, b) =>
						Number(isPortionPack(this.byId.get(a.productId)?.p)) -
						Number(isPortionPack(this.byId.get(b.productId)?.p))
				);
		const hits = kept.slice(0, limit);
		if (hits.length)
			return {
				status: 'resolved',
				query,
				candidates: hits.map((c) => ({ productId: c.productId, score: c.score ?? 0 }))
			};
		if (guarded.dropped.length)
			return {
				status: 'unresolved',
				query,
				reason: guarded.reason,
				nearest: guarded.dropped
					.slice(0, 3)
					.map((d) => ({ productId: d.c.productId, failed: d.failed }))
			};
		if (diet.size) {
			const any = this.similar(t, new Set(), 3, { minLex: 0.5, diet: new Set(), strict: true });
			if (any.length) {
				const need = [...diet].map((f) => DIET_WORD[f] ?? f).join(' and ');
				return {
					status: 'unresolved',
					query,
					reason: `products match "${query}" but none is ${need}`,
					nearest: any.map((c) => ({ productId: c.productId, failed: [...diet].join(',') }))
				};
			}
		}
		const partial = this.similar(t, new Set(), 3, { minLex: 0.25, diet: new Set() });
		const main = query
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w && !DIET_KEYS.some((k) => k.word.test(w)));
		return {
			status: 'unresolved',
			query,
			reason: partial.length
				? `no product whose main ingredient is ${main.join(' ') || query}; the nearest are other products or share only part of the name`
				: `no product name matches "${query}"`,
			nearest: partial.map((c) => ({ productId: c.productId, failed: 'match' }))
		};
	}

	/**
	 * Category guards on resolve candidates, from Valio's category codes:
	 * - the query's kind is what its own name matches mostly are (products whose name has the query word itself or as
	 *   the compound head): a fish query keeps fish, a seasoning query keeps seasoning and baking categories;
	 * - a vegetarian or vegan dish keeps no meat, poultry or fish; vegan also no declared milk or egg and no honey or
	 *   gelatine (an undeclared pick passes, and the proposer labels it "no allergen record — check");
	 * - a candidate below MIN_RESOLVE_SCORE is not pinned.
	 */
	private guard(
		query: string,
		pool: Candidate[],
		plant: string[],
		asked: string[] = []
	): {
		kept: Candidate[];
		dropped: { c: Candidate; failed: 'category' | 'diet' | 'allergen' | 'match' }[];
		reason: string;
	} {
		const named = contentWords(query).filter((w) => !DIET_KEYS.some((k) => k.word.test(w)));
		const rows = pool.map((c) => ({ c, it: this.byId.get(c.productId)! })).filter((r) => r.it);
		// A word as typed or in its base form ("kermaa" → "kerma"); "suklaa" stays a match as typed.
		const has = (words: string[], q: string) =>
			[q, baseForm(q)].some((x) => words.some((w) => w === x || (x.length >= 4 && w.endsWith(x))));
		const headStrong = rows.filter((r) => named.every((q) => has(r.it.words, q)));
		const base = headStrong.length ? headStrong : rows;
		const count = new Map<FoodKind, number>();
		for (const r of base) {
			const k = foodKind(r.it.p.category);
			count.set(k, (count.get(k) ?? 0) + 1);
		}
		// The kind to keep, in a fixed order: a spice term (a sixth of its own matches are seasoning; vanilla flavours far
		// more yoghurts than it has pods) is seasoning; otherwise the animal kind with a majority, the largest share first.
		const share = (k: FoodKind) => (count.get(k) ?? 0) / Math.max(1, base.length);
		let want: FoodKind | null = null;
		if (share('seasoning') >= 0.15) want = 'seasoning';
		else {
			const top = [...ANIMAL].sort((a, b) => share(b) - share(a))[0];
			if (share(top) > 0.5) want = top;
		}
		const reasons: string[] = [];
		const kept: Candidate[] = [];
		const dropped: { c: Candidate; failed: 'category' | 'diet' | 'allergen' | 'match' }[] = [];
		const vegan = plant.includes('VEGAN');
		for (const r of rows) {
			const k = foodKind(r.it.p.category);
			let why: [string, 'category' | 'diet' | 'allergen' | 'match'] | null = null;
			if (want && k !== want)
				why = [
					`"${query}" is ${want}; this is ${k === 'other' ? 'another kind of product' : k}`,
					'category'
				];
			else if (plant.length && ANIMAL.has(k))
				why = [`a ${plant.join('/').toLowerCase()} dish takes no ${k}`, 'diet'];
			else if (vegan && r.it.p.allergens?.contains.some((a) => a === 'AM' || a === 'AE'))
				why = ['a vegan dish takes no milk or egg', 'allergen'];
			else if (
				vegan &&
				(r.it.p.category === '22150' ||
					r.it.p.category === '22670' ||
					NOT_VEGAN.test(r.it.p.nameFi))
			)
				why = ['a vegan dish takes no honey or gelatine', 'diet'];
			else if ((r.c.score ?? 0) < MIN_RESOLVE_SCORE) why = ['the name matches too weakly', 'match'];
			if (why) {
				dropped.push({ c: r.c, failed: why[1] });
				if (!reasons.includes(why[0])) reasons.push(why[0]);
			} else kept.push(r.c);
		}
		// A product sold as free-from (its name says so) that nobody asked for goes after the plain ones: gluten-free
		// bread for "leipä". Meat is free from milk in the data without being sold as such.
		const unasked = (c: Candidate) => {
			const d = dietOf(this.byId.get(c.productId)!.p, true);
			return DIET_KEYS.some((k) => d.has(k.flag) && !asked.includes(k.flag)) ? 1 : 0;
		};
		// A meat query is served as a roast or whole cut first: raw and whole-ham categories before sliced cold cuts
		// (172xx), so "kinkku" for a Christmas buffet is a whole ham, not a 500 g serrano pack, unless the words ask
		// for slices or a cured product.
		const coldCutAsked = named.some((w) =>
			/viipale|viipaloitu|leike|siivu|salami|makkara|pekoni|nakki|serrano|parma|crudo|coppa/.test(w)
		);
		const isColdCut = (c: Candidate) => {
			const cat = Number(this.byId.get(c.productId)!.p.category);
			return cat >= 17200 && cat <= 17210;
		};
		const wholeMeat = kept.some(
			(c) => foodKind(this.byId.get(c.productId)!.p.category) === 'meat' && !isColdCut(c)
		);
		const coldCut = (c: Candidate) => (wholeMeat && !coldCutAsked && isColdCut(c) ? 1 : 0);
		// A vegan pick without an allergen record is kept in score order (fresh produce rarely has one); the proposer
		// labels it "no allergen record — check" rather than calling it vegan.
		kept.sort((a, b) => unasked(a) - unasked(b) || coldCut(a) - coldCut(b));
		return {
			kept,
			dropped,
			reason: `no product whose main ingredient is ${named.join(' ') || query} fits: ${reasons.slice(0, 2).join('; ')}`
		};
	}

	/**
	 * Non-rule candidates for `target`, best first (ties by product id). `minLex` is the minimum name match; `diet`
	 * overrides the dietary properties taken from the target's name.
	 */
	/**
	 * Similarity scans the whole index, and every visitor planning the same event asks for the same targets; the
	 * index never changes after it is built, so an answer is kept per (target, excluded ids, limit, options).
	 */
	private similarCache = new Map<string, Candidate[]>();
	similar(
		target: RetrievalProduct,
		exclude: Set<ProductId>,
		limit: number,
		o: { minLex?: number; diet?: Set<string>; strict?: boolean } = {}
	): Candidate[] {
		const key = JSON.stringify([
			target,
			[...exclude].sort(),
			limit,
			o.minLex ?? null,
			o.diet ? [...o.diet].sort() : null,
			o.strict ?? false
		]);
		const hit = this.similarCache.get(key);
		if (hit) return hit.map((c) => ({ ...c }));
		const out = this.similarScan(target, exclude, limit, o);
		if (this.similarCache.size >= 5000) this.similarCache.clear();
		this.similarCache.set(key, out);
		return out.map((c) => ({ ...c }));
	}
	private similarScan(
		target: RetrievalProduct,
		exclude: Set<ProductId>,
		limit: number,
		o: { minLex?: number; diet?: Set<string>; strict?: boolean }
	): Candidate[] {
		const minLex = o.minLex ?? 0.25;
		const tWords = contentWords(`${target.nameFi} ${target.nameEn ?? ''}`, target.brand);
		// The food itself: the target's words that are not a form or state ("paistettu muna" is an egg, fried). A
		// substitute must share one, so a fried egg never gets fried onions; the form may differ and is named elsewhere.
		const heads = tWords.filter((w) => !FORM_WORD.test(w));
		const weights = tWords.map((w) => this.idf(w));
		const total = weights.reduce((a, b) => a + b, 0) || 1;
		const diet = o.diet ?? dietOf(target, true);
		const scored: { id: ProductId; score: number; reason: CandidateReason }[] = [];
		for (const { p, words } of this.items) {
			if (exclude.has(p.productId)) continue;
			// Weighted share of the target's words found in the candidate, and of the candidate's words found in the
			// target: a ready dish that merely contains the ingredient has many words the target lacks.
			let lex = 0;
			for (let i = 0; i < tWords.length; i++) {
				let best = 0;
				for (const w of words) {
					const s = wordSim(tWords[i], w);
					if (s > best) best = s;
					if (best === 1) break;
				}
				lex += best * weights[i];
			}
			lex /= total;
			if (lex < minLex) continue;
			if (!o.strict && heads.length && !heads.some((h) => words.some((w) => wordSim(h, w) >= 0.6)))
				continue;
			let cov = 0;
			let cTotal = 0;
			for (const w of words) {
				const wt = this.idf(w);
				cTotal += wt;
				let best = 0;
				for (const t of tWords) best = Math.max(best, wordSim(w, t));
				cov += best * wt;
			}
			cov = cTotal ? cov / cTotal : 0;
			const extra = words.filter(
				(w) => PROCESSED.test(w) && !tWords.some((t) => wordSim(t, w) >= 0.8)
			).length;
			const sameCat = target.category !== '' && p.category === target.category;
			if (o.strict) {
				// resolve(): the product is the ingredient, not a dish or mix that contains it; diets may be met by a
				// declared allergen record.
				const named = tWords.filter((w) => !DIET_KEYS.some((k) => k.word.test(w)));
				if (!named.every((q) => present(q, words) || present(baseForm(q), words))) continue;
				if (
					words.some(
						(w) =>
							OTHER_PRODUCT.test(w) &&
							!named.some((q) => w.endsWith(q) || q.endsWith(w.match(OTHER_PRODUCT)![1]))
					)
				)
					continue;
				if ([...diet].some((f) => !PLANT_FLAGS.has(f) && !meetsDiet(p, f))) continue;
			} else if (diet.size > 0) {
				const d = dietOf(p, false);
				if ([...diet].some((f) => !d.has(f))) continue;
			}
			const score =
				0.7 * lex +
				0.3 * cov -
				0.3 * Math.min(extra, 2) +
				(sameCat
					? 0.2
					: target.categoryGroup && p.categoryGroup === target.categoryGroup
						? 0.08
						: 0) +
				(p.temperatureClass === target.temperatureClass ? 0.05 : 0);
			scored.push({ id: p.productId, score, reason: sameCat && lex < 0.5 ? 'category' : 'name' });
		}
		scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
		return scored.slice(0, limit).map((s) => ({
			productId: s.id,
			fromValioRule: false,
			reason: s.reason,
			score: Math.round(s.score * 1000) / 1000
		}));
	}
}

/** Valio's rules first (only ids that exist), then the mode's pool, cut to `limit` (rules are never cut). */
export function assemble(
	target: RetrievalProduct & { valioSubstitutes: ProductId[] },
	exists: (id: ProductId) => boolean,
	rest: (exclude: Set<ProductId>, room: number) => Candidate[],
	limit: number
): Candidate[] {
	const rules: Candidate[] = target.valioSubstitutes
		.filter(exists)
		.map((id) => ({ productId: id, fromValioRule: true, reason: 'rule' }));
	const exclude = new Set([target.productId, ...rules.map((r) => r.productId)]);
	const room = Math.max(0, limit - rules.length);
	return [...rules, ...rest(exclude, room).slice(0, room)];
}

export const toRetrievalProduct = (p: Product): RetrievalProduct => ({
	productId: p.productId,
	nameFi: p.nameFi,
	nameEn: p.nameEn,
	brand: p.brand,
	category: p.category,
	categoryGroup: p.categoryGroup,
	temperatureClass: p.temperatureClass,
	isFood: p.isFood,
	freeFrom: p.freeFrom,
	dataQualityFlags: p.dataQualityFlags,
	netUnit: p.netPerSalesUnit?.value.unit,
	allergens: { contains: p.allergens.contains, declared: p.allergens.declared }
});

/** Whether a query uses a word only SEARCH_WORDS can read (English or colloquial): it searches tolerantly first. */
export const usesSearchWords = (query: string) =>
	query
		.toLowerCase()
		.split(/[^a-zåäö]+/)
		.some(
			(w) =>
				w in SEARCH_WORDS || (w.length > 4 && w.endsWith('s') && w.slice(0, -1) in SEARCH_WORDS)
		);

/** Below this a tolerant hit is a guess, not a match (S3 asks "Did you mean…?" from 0.45 to 0.75). */
export const ASK_BAR = 0.45;

export interface ScoredSearch {
	products: Product[];
	hits: ScoredHit[];
	readAs: string;
	corrected?: string;
}

/**
 * search_products for a chef's words, shared by both catalogue adapters: an exact query keeps today's search; a
 * query in English or colloquial words, or one that finds nothing, goes through the tolerant search, with the best
 * few and how sure each is.
 */
export async function scoredSearch(
	query: string,
	limit: number,
	exact: () => Promise<Product[]>,
	index: () => Promise<RetrievalIndex> | RetrievalIndex,
	get: (ids: ProductId[]) => Promise<Map<ProductId, Product>>
): Promise<ScoredSearch> {
	if (!usesSearchWords(query)) {
		const found = await exact();
		if (found.length)
			return {
				products: found,
				hits: found.map((p) => ({ productId: p.productId, confidence: 1, readAs: query })),
				readAs: query
			};
	}
	const t = (await index()).searchTolerant(query, Math.min(limit, 5));
	const docs = await get(t.hits.map((h) => h.productId));
	const hits = t.hits.filter((h) => docs.has(h.productId));
	// Below the asking bar nothing matched: no products (callers keep their "nothing found" path), the closest few
	// stay in hits for a labelled "closest we have".
	return {
		products: hits.filter((h) => h.confidence >= ASK_BAR).map((h) => docs.get(h.productId)!),
		hits,
		readAs: t.readAs,
		...(t.corrected ? { corrected: t.corrected } : {})
	};
}
