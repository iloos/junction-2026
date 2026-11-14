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

const DIET_WORD: Record<string, string> = { LACTOSE: 'lactose-free', GLUTEN: 'gluten-free' };

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
	const [s, l] = a.length <= b.length ? [a, b] : [b, a];
	if (s.length >= 4 && l.endsWith(s)) return 0.8;
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
	/(keitto|laatikko|piirakka|piiras|kastike|kastikkeessa|kiisseli|marmeladi|hillo|jogurtti|juusto|hummus|falafel|pihvi|kiusaus|pulla|pullat|sipsi|terriini|kierre|rieska|leipä|tortilla|panini|majoneesi|salaatti|ruutu|kuutio|sekoitus|seos|mix|pyree|sose|bowl|vuoka|pizza|lasagne|makkara|nakki|lenkki|pasteija|mureke|croquette|kroketti|lastu|muusi|ateria|annos|valmiste|leike|levite|smoothie|mehu|juoma|kakku|leivos|aine|tee|grilleri|pasta|sandwich|wrap|patonki|sämpylä|lettu|keksi|sipsit|puuro|rahka|mousse|vanukas)$/;

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
/** Diet flags that are about the dish, not a free-from label: no meat or fish (and for vegan, no milk or egg). */
const PLANT_FLAGS = new Set(['VEGETARIAN', 'VEGAN']);
/** Below this retrieval score a resolve candidate is too weak to pin. */
export const MIN_RESOLVE_SCORE = 0.4;

interface Indexed {
	p: RetrievalProduct;
	words: string[];
}

/** Lazily built word index over the catalogue (document frequency per word). */
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
	 * Resolve an ingredient query. Dietary requirements come from the query's words ("laktoositon kerma") and from
	 * `diet` (e.g. ['LACTOSE'] for a lactose-free menu). Unresolved results say which bar was not cleared.
	 */
	resolve(raw: string, o: { limit?: number; diet?: string[] } = {}): Resolution {
		// Plural fillets read as the fillet: "kirjolohifileet" is "kirjolohifilee".
		const query = raw.replace(/fileet(?![a-zåäö])/gi, 'filee');
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
		const hits = guarded.kept.slice(0, limit);
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
					.map((c) => ({ productId: c.productId, failed: 'category' }))
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
	 * - a vegetarian or vegan dish keeps no meat, poultry or fish (vegan: no declared milk or egg either);
	 * - a candidate below MIN_RESOLVE_SCORE is not pinned.
	 */
	private guard(
		query: string,
		pool: Candidate[],
		plant: string[],
		asked: string[] = []
	): { kept: Candidate[]; dropped: Candidate[]; reason: string } {
		const named = contentWords(query).filter((w) => !DIET_KEYS.some((k) => k.word.test(w)));
		const rows = pool.map((c) => ({ c, it: this.byId.get(c.productId)! })).filter((r) => r.it);
		const headStrong = rows.filter((r) =>
			named.every((q) => r.it.words.some((w) => w === q || (q.length >= 4 && w.endsWith(q))))
		);
		const base = headStrong.length ? headStrong : rows;
		const count = new Map<FoodKind, number>();
		for (const r of base) {
			const k = foodKind(r.it.p.category);
			count.set(k, (count.get(k) ?? 0) + 1);
		}
		let want: FoodKind | null = null;
		for (const [k, n] of count) {
			if (k === 'other') continue;
			// Seasoning wins with a sixth of the matches (vanilla flavours far more yoghurts than it has pods); a protein
			// needs a majority.
			const share = n / Math.max(1, base.length);
			if ((k === 'seasoning' && share >= 0.15) || (ANIMAL.has(k) && share > 0.5)) want = k;
		}
		const reasons: string[] = [];
		const kept: Candidate[] = [];
		const dropped: Candidate[] = [];
		for (const r of rows) {
			const k = foodKind(r.it.p.category);
			let why: string | null = null;
			if (want && k !== want)
				why = `"${query}" is ${want}; this is ${k === 'other' ? 'another kind of product' : k}`;
			else if (plant.length && ANIMAL.has(k))
				why = `a ${plant.join('/').toLowerCase()} dish takes no ${k}`;
			else if (
				plant.includes('VEGAN') &&
				r.it.p.allergens?.contains.some((a) => a === 'AM' || a === 'AE')
			)
				why = 'a vegan dish takes no milk or egg';
			else if ((r.c.score ?? 0) < MIN_RESOLVE_SCORE) why = 'the name matches too weakly';
			if (why) {
				dropped.push(r.c);
				if (!reasons.includes(why)) reasons.push(why);
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
	similar(
		target: RetrievalProduct,
		exclude: Set<ProductId>,
		limit: number,
		o: { minLex?: number; diet?: Set<string>; strict?: boolean } = {}
	): Candidate[] {
		const minLex = o.minLex ?? 0.25;
		const tWords = contentWords(`${target.nameFi} ${target.nameEn ?? ''}`, target.brand);
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
				if (!named.every((q) => present(q, words))) continue;
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
