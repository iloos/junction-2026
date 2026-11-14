/**
 * Substitute candidate retrieval shared by the file and Postgres catalogues, so both return the same pool in the
 * same order. Recall only: ranking, hard constraints and fit are judged later (core/rank, validator, Decide).
 *
 * Modes:
 * - `id` (default): Valio's rules, then the same category + temperature class + net unit in product-id order.
 * - `hybrid` (`CATALOG_RETRIEVAL=hybrid`): Valio's rules, then products whose Finnish/English name shares a content
 *   word with the target (Finnish compound heads count: "palvikinkku" matches "juhlakinkku" on "kinkku"), weighted by
 *   how rare the word is, with small bonuses for the same category and temperature class. A candidate must clear a
 *   minimum match; the same category alone is not enough. Dietary properties the target has (lactose-free,
 *   gluten-free) are kept as a hard filter.
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
> & { netUnit?: string };

export function retrievalModeFromEnv(): RetrievalMode {
	return (typeof process !== 'undefined' && process.env?.CATALOG_RETRIEVAL) === 'hybrid'
		? 'hybrid'
		: 'id';
}

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

interface Indexed {
	p: RetrievalProduct;
	words: string[];
}

/** Lazily built word index over the catalogue (document frequency per word). */
export class RetrievalIndex {
	private items: Indexed[];
	private df = new Map<string, number>();
	constructor(products: Iterable<RetrievalProduct>) {
		this.items = [];
		for (const p of products) {
			if (!p.isFood || p.dataQualityFlags.includes('old_flagged_name')) continue;
			const words = contentWords(`${p.nameFi} ${p.nameEn ?? ''}`, p.brand);
			this.items.push({ p, words });
			for (const w of words) this.df.set(w, (this.df.get(w) ?? 0) + 1);
		}
	}
	private idf(w: string) {
		return Math.log(1 + this.items.length / (1 + (this.df.get(w) ?? 0)));
	}

	/** Non-rule candidates for `target`, best first (ties by product id). */
	similar(target: RetrievalProduct, exclude: Set<ProductId>, limit: number): Candidate[] {
		const tWords = contentWords(`${target.nameFi} ${target.nameEn ?? ''}`, target.brand);
		const weights = tWords.map((w) => this.idf(w));
		const total = weights.reduce((a, b) => a + b, 0) || 1;
		const diet = dietOf(target, true);
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
			if (lex < 0.25) continue;
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
			const sameCat = p.category === target.category;
			if (diet.size > 0) {
				const d = dietOf(p, false);
				if ([...diet].some((f) => !d.has(f))) continue;
			}
			const score =
				0.7 * lex +
				0.3 * cov -
				0.3 * Math.min(extra, 2) +
				(sameCat ? 0.2 : p.categoryGroup === target.categoryGroup ? 0.08 : 0) +
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
	netUnit: p.netPerSalesUnit?.value.unit
});
