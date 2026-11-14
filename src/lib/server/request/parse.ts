/**
 * Request text → structured purchase request. Two parsers, one output shape:
 * - rules: deterministic, no network; good for Valio's own example and close variants (EN + FI).
 * - gemini: Flash-Lite with JSON output through the Llm port (traced); dates are still resolved by
 *   the rules against the simulator clock, and any disagreement with the rules is shown, not hidden.
 * Nothing ambiguous is guessed silently: each guess lands in `ambiguities`.
 */
import { z } from 'zod';
import { day } from '$lib/ui/format';
import type { Llm } from '$lib/core/ports';
import { findDate, realDate, weekdayName, weekdayOf } from './dates';
import {
	CONSTRAINTS,
	NUMBER_WORDS,
	PRODUCTS,
	UNITS,
	UNKNOWN_UNITS,
	brandIn,
	esc,
	type ConstraintKey,
	type ProductWord,
	type ReqUnit
} from './lexicon';

export interface ParsedItem {
	/**
	 * Stable id for answers: product key (or the typed words), constraints and variant, numbered when
	 * repeated. The same words give the same id on every run and on both parser paths, so an inline
	 * answer stays on its item when the model splits the request differently.
	 */
	id: string;
	/** The words of the request this item came from. */
	text: string;
	/** What was asked for, in the chef's words minus quantity ("lactose-free milk"). */
	query: string;
	/** Lexicon key when the product word is known. */
	product: string | null;
	/** Finnish catalogue search words, most specific first. */
	search: string[];
	qty: number | null;
	unit: ReqUnit | null;
	constraints: ConstraintKey[];
	/** A variant the request named ("whole"), as a catalogue name token. */
	variant: { token: string; label: string; search?: string } | null;
	ambiguities: string[];
	/** An explicit unit the request can't order in ("oz"): the amount is asked again, never guessed. */
	unitToken?: string;
	/** A brand the words named ("Arla"): required at lookup. */
	brand?: string;
}

export interface ParsedRequest {
	text: string;
	items: ParsedItem[];
	deliverBy: string;
	deliverByText: string | null;
	deliverBySource: 'request' | 'default';
	/** The chef chose this date on the page (date control or a cut-off answer), over the words' one. */
	deliverByChosen?: boolean;
	/** A dish with a count: how it was read, both ways to serve it, and which one the items are. */
	dish?: import('./dish').DishInterpretation;
	dishChoice?: 'ready' | 'raw';
	notes: string[];
	/** Request-level questions (date, disagreements); item questions live on the item. */
	ambiguities: string[];
	answered?: { item: string; qty?: number; unit?: ReqUnit; productId?: string }[];
	parser: {
		kind: 'rules' | 'gemini' | 'featherless' | 'fixture';
		model: string;
		latencyMs: number;
		tokens?: { in: number; out: number };
		/** Set when the model path failed and the rules answered instead. */
		fallback?: string;
	};
}

const FILLER = new Set([
	'i',
	'we',
	'need',
	'needs',
	'want',
	'please',
	'order',
	'get',
	'buy',
	'us',
	'me',
	'some',
	'of',
	'the',
	'x',
	'×',
	'deliver',
	'delivered',
	'delivery',
	'tilaa',
	'tilaisitko',
	'tarvitaan',
	'tarvitsen',
	'tarvitsemme',
	'kiitos',
	'tarvis'
]);

/** Short everyday words that follow a number without being a unit ("50 on Friday", "2 ja 3"). */
const SHORT_WORDS = new Set(
	'on in at by to is it we my or an as so up no me us am pm ja ei se ne tai klo'.split(' ')
);

/**
 * A word right after a number that names a unit the request can't order in: a known one (oz, cup), or a one- or
 * two-letter token that is no word the parser knows ("250 zz"). Longer unknown words are product words.
 */
export function unknownUnitWord(w: string): boolean {
	const k = w.toLowerCase().replace(/\.$/, '');
	if (UNKNOWN_UNITS.has(k)) return true;
	return (
		/^\p{L}{1,2}$/u.test(k) &&
		!unitOf(k) &&
		!productOf(k) &&
		!constraintOf(k) &&
		!FILLER.has(k) &&
		!SHORT_WORDS.has(k) &&
		NUMBER_WORDS[k] === undefined
	);
}

/** "1,000" / "1 000" = thousands; "1,5" / "1.5" = decimal. Returns the value and whether the comma was ambiguous. */
export function parseNumber(s: string): { value: number; commaThousands: boolean } | null {
	const t = s.replace(/\s/g, '');
	if (/^\d{1,3}(,\d{3})+$/.test(t))
		return { value: Number(t.replace(/,/g, '')), commaThousands: true };
	if (/^\d+([.,]\d+)?$/.test(t))
		return { value: Number(t.replace(',', '.')), commaThousands: false };
	return null;
}

const NUM_RE = /(\d{1,3}(?:\s\d{3})+(?![\d,.])|\d{1,3}(?:,\d{3})+(?![\d])|\d+(?:[.,]\d+)?)/;

function unitOf(word: string): { unit: ReqUnit; factor: number } | null {
	const w = word.toLowerCase().replace(/\.$/, '');
	for (const u of UNITS) if (u.forms.includes(w)) return { unit: u.unit, factor: u.factor };
	return null;
}

function productOf(word: string): ProductWord | null {
	return PRODUCTS.find((p) => p.forms.includes(word)) ?? null;
}

function constraintOf(word: string): ConstraintKey | null {
	return CONSTRAINTS.find((c) => c.forms.includes(word))?.key ?? null;
}

const looksFinnish = (text: string) =>
	/(maitoa|laktoositon|perunaa|voita|kermaa|ksi\b|laatikko|tarvi|tilaa|\bja\b|[äö])/i.test(text);

/** Splits a request into item phrases: on ";", newlines, "+", ", " and "and"/"ja". */
export function splitItems(text: string): string[] {
	return text
		.split(/\s*(?:;|\n|\+|,\s+|\s+(?:and|ja|&)\s+)\s*/i)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Catalogue searches, most specific first; the last one is always the bare product word. */
export function buildSearch(
	typed: string,
	constraints: ConstraintKey[],
	variant: ParsedItem['variant'] = null
): string[] {
	if (!typed) return [];
	const cwords = CONSTRAINTS.filter((c) => constraints.includes(c.key) && c.search).map(
		(c) => c.search!
	);
	const first = variant?.search ? [[variant.search, ...cwords].join(' ')] : [];
	return [...new Set([...first, [typed, ...cwords].join(' '), typed])];
}

/** The product's variant the words name, if any. */
function variantIn(product: ProductWord | null, words: string[]): ParsedItem['variant'] {
	// The last variant named wins, as in "whole … semi-skimmed".
	const v = product?.variants?.findLast((v) => v.words.some((w) => words.includes(w)));
	return v ? { token: v.token, label: v.label, ...(v.search ? { search: v.search } : {}) } : null;
}

/** Every constraint the words state, single words and two-word forms ("lactose free"). */
export function constraintsIn(text: string): ConstraintKey[] {
	const words = text
		.toLowerCase()
		.replace(/[!?()"“”,.;:]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	const out: ConstraintKey[] = [];
	for (let i = 0; i < words.length; i++) {
		const c =
			(words[i + 1] ? constraintOf(`${words[i]} ${words[i + 1]}`) : null) ?? constraintOf(words[i]);
		if (c && !out.includes(c)) out.push(c);
	}
	return out;
}

/** Lower-case words joined by "-", at most `max` characters: the stable part of an id. */
export const slug = (s: string, max = 40) =>
	s
		.toLowerCase()
		.replace(/[^\p{L}\d]+/gu, '-')
		.slice(0, max)
		.replace(/^-+|-+$/g, '') || 'item';

/** The id an item gets from what it asks for (not its quantity, which an answer may change). */
export function baseId(
	it: Pick<ParsedItem, 'product' | 'search' | 'query' | 'constraints' | 'variant'>
): string {
	return [
		it.product ?? slug(it.search.at(-1) ?? it.query),
		...[...it.constraints].sort(),
		it.variant?.token
	]
		.filter(Boolean)
		.join('.');
}

/** Numbers repeated ids ("milk", "milk~2") in list order. */
function withIds(items: (Omit<ParsedItem, 'id'> & { id?: string })[]): ParsedItem[] {
	const seen = new Map<string, number>();
	return items.map((it) => {
		const b = it.id ?? baseId(it);
		const n = (seen.get(b) ?? 0) + 1;
		seen.set(b, n);
		return { ...it, id: n === 1 ? b : `${b}~${n}` };
	});
}

/** "for 300 breakfasts": how many are served, never an amount to buy. */
const COVERS =
	/(?:\bfor\s+)?(\d[\d\s,]*)\s+(breakfasts?|lunch(?:es)?|dinners?|meals?|guests|people|persons|covers|portions|servings|pax|diners|hengelle|henkeä|annosta|annokselle|aamiaiselle|lounaalle)(?![\p{L}])/iu;

/** "2 x 10 kg" / "4×5 l": a count of packs of a stated size, i.e. 20 kg. */
const MULTIPACK = /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s+([\p{L}.]+)/iu;

/** One item phrase → an item. */
export function parseItem(chunk: string, finnish: boolean): Omit<ParsedItem, 'id'> | null {
	const ambiguities: string[] = [];
	let s = chunk.toLowerCase();
	// "1000l" → "1000 l", "2x" → "2 x"
	s = s.replace(/(\d)([a-zäöå×])/giu, '$1 $2');

	let covers: string | null = null;
	const cv = s.match(COVERS);
	if (cv) {
		covers = cv[0].trim();
		s = s.replace(cv[0], ' ');
	}
	// A named brand is kept on the item (and required at lookup), never left as a stray word.
	const brand = brandIn(s);
	if (brand) s = s.replace(new RegExp(esc(brand.toLowerCase()), 'u'), ' ');
	const mp = s.match(MULTIPACK);
	if (mp) {
		const u = unitOf(mp[3]);
		const n = parseNumber(mp[2]);
		if (u && n && u.unit !== 'sales')
			s = s.replace(mp[0], `${+(Number(mp[1]) * n.value).toFixed(6)} ${mp[3]}`);
	}

	let qty: number | null = null;
	let unit: ReqUnit | null = null;
	let unitWordAt = -1;
	const m = s.match(NUM_RE);
	let before = s;
	let after = '';
	if (m && m.index !== undefined) {
		const n = parseNumber(m[1])!;
		qty = n.value;
		if (n.commaThousands && finnish)
			ambiguities.push(
				`read "${m[1]}" as ${qty.toLocaleString('en-IE')} (comma as thousands); in Finnish it could mean ${m[1].replace(',', '.')}`
			);
		before = s.slice(0, m.index);
		after = s.slice(m.index + m[0].length);
	}

	const words = `${before} ${after}`
		.replace(/[!?()"“”]/g, ' ')
		.split(/\s+/)
		.map((w) => w.replace(/^[,.:]+|[,.:]+$/g, ''))
		.filter(Boolean);

	// The unit is the first word after the number (or a number word when no digit was given).
	const afterWords = after.split(/\s+/).filter(Boolean);
	let unknownUnit: string | null = null;
	if (qty !== null && afterWords.length) {
		const w0 = afterWords[0].replace(/^[,.:]+|[,.:]+$/g, '');
		const u = unitOf(w0);
		if (u) {
			unit = u.unit;
			qty = +(qty * u.factor).toFixed(6);
			unitWordAt = words.indexOf(w0);
		} else if (unknownUnitWord(w0)) {
			// An explicit unit the request can't order in: asked, never read as sales units.
			unknownUnit = w0;
			unitWordAt = words.indexOf(w0);
		}
	}
	if (qty === null) {
		const wi = words.findIndex((w) => NUMBER_WORDS[w] !== undefined);
		if (wi >= 0) {
			qty = NUMBER_WORDS[words[wi]];
			const u = words[wi + 1] ? unitOf(words[wi + 1]) : null;
			if (u) {
				unit = u.unit;
				qty = +(qty * u.factor).toFixed(6);
				unitWordAt = wi + 1;
			}
			words.splice(wi, 1);
			if (unitWordAt > wi) unitWordAt -= 1;
		}
	}
	if (unitWordAt >= 0) words.splice(unitWordAt, 1);

	// Two-word forms first ("lactose free", "wheat flour"), then single words.
	const constraints: ConstraintKey[] = [];
	let product: ProductWord | null = null;
	const rest: string[] = [];
	const used = new Set<number>();
	for (let i = 0; i < words.length; i++) {
		if (used.has(i)) continue;
		const pair = words[i + 1] ? `${words[i]} ${words[i + 1]}` : null;
		const pc = pair ? constraintOf(pair) : null;
		const pp = pair ? productOf(pair) : null;
		if (pc || pp) {
			if (pc && !constraints.includes(pc)) constraints.push(pc);
			if (pp) product = pp;
			used.add(i).add(i + 1);
			continue;
		}
		const c = constraintOf(words[i]);
		if (c) {
			if (!constraints.includes(c)) constraints.push(c);
			continue;
		}
		const p = productOf(words[i]);
		if (p) {
			product = p;
			continue;
		}
		if (!FILLER.has(words[i]) && !unitOf(words[i])) rest.push(words[i]);
	}

	const variant = variantIn(product, words);
	// Variant words are not leftovers.
	const leftovers = rest.filter(
		(w) => !product?.variants?.some((v) => v.words.includes(w)) && !/^\d/.test(w)
	);

	if (!product && leftovers.length === 0 && qty === null) return null;
	if (!product)
		ambiguities.push(
			leftovers.length
				? `"${leftovers.join(' ')}" is not in my word list: searched the catalogue as typed`
				: 'no product named: what should I order?'
		);
	if (unknownUnit) {
		ambiguities.push(
			`"${qty} ${unknownUnit}": I can't order in ${unknownUnit}. How much, in kg, l, pieces, cases or packs?`
		);
		qty = null;
		unit = null;
	} else if (qty === null)
		ambiguities.push(
			covers
				? `no quantity given: how much? ("${covers}" is how many you serve, not an amount)`
				: 'no quantity given: how much?'
		);
	else if (unit === null) {
		unit = 'sales';
		ambiguities.push(`no unit given: read as ${qty} of the product's own sales unit`);
	}

	const query = [
		...CONSTRAINTS.filter((c) => constraints.includes(c.key)).map((c) => c.label),
		variant?.label,
		product?.key ?? leftovers.join(' ')
	]
		.filter(Boolean)
		.join(' ');

	const search = buildSearch(product ? product.search : leftovers.join(' '), constraints, variant);
	return {
		text: chunk.trim(),
		query: brand ? `${brand} ${query}` : query,
		product: product?.key ?? null,
		search: brand && search.length ? [`${brand.toLowerCase()} ${search[0]}`, ...search] : search,
		...(brand ? { brand } : {}),
		qty,
		unit,
		constraints,
		variant,
		ambiguities,
		...(unknownUnit ? { unitToken: unknownUnit } : {})
	};
}

/** An item with more constraints: its query and searches are rebuilt from the same words. */
function addConstraints(it: Omit<ParsedItem, 'id'>, more: ConstraintKey[]): Omit<ParsedItem, 'id'> {
	const constraints = [...it.constraints, ...more.filter((c) => !it.constraints.includes(c))];
	if (constraints.length === it.constraints.length) return it;
	const added = constraints.filter((c) => !it.constraints.includes(c));
	return {
		...it,
		constraints,
		query: `${added.map(label).join(' ')} ${it.query}`,
		search: buildSearch(it.search.at(-1) ?? it.query, constraints, it.variant)
	};
}

/**
 * Item phrases → items. A clause that only states constraints ("2 l milk, lactose free, for Thursday",
 * "vispikermaa 10 litraa, laktoositon") belongs to the item before it (or after it, when it comes first).
 */
function withClauseConstraints(chunks: string[], finnish: boolean): Omit<ParsedItem, 'id'>[] {
	const items: Omit<ParsedItem, 'id'>[] = [];
	let carry: ConstraintKey[] = [];
	for (const c of chunks) {
		const it = parseItem(c, finnish);
		if (it) {
			items.push(carry.length ? addConstraints(it, carry) : it);
			carry = [];
			continue;
		}
		const cs = constraintsIn(c);
		if (!cs.length) continue;
		if (items.length) items[items.length - 1] = addConstraints(items[items.length - 1], cs);
		else carry.push(...cs);
	}
	return items;
}

/** The deterministic parser. `today` is the simulator clock's Helsinki date. */
export function parseRules(text: string, today: string): Omit<ParsedRequest, 'parser'> {
	const notes: string[] = [];
	const ambiguities: string[] = [];
	const date = findDate(text, today);
	const body = date ? text.replace(date.text, ' ') : text;
	const finnish = looksFinnish(text);
	const items = withIds(withClauseConstraints(splitItems(body), finnish));

	let deliverBy = today;
	if (date?.invalid) {
		ambiguities.push(`${date.invalid}: using today, ${day(today)}`);
	} else if (date) {
		deliverBy = date.iso;
		if (date.note) notes.push(`"${date.text}": ${date.note}`);
		if (date.iso < today) ambiguities.push(`"${date.text}" is in the past`);
	} else ambiguities.push(`no delivery date given: using today, ${day(today)}`);
	if (weekdayOf(deliverBy) === 0) notes.push(`delivery falls on a Sunday (${day(deliverBy)})`);
	if (items.length === 0) ambiguities.push('no item found: try "200 kg potatoes by Friday"');

	return {
		text,
		items,
		deliverBy,
		deliverByText: date?.text ?? null,
		deliverBySource: date && !date.invalid ? 'request' : 'default',
		notes,
		ambiguities
	};
}

/* ── Model path ─────────────────────────────────────────────────────────── */

const LlmItem = z.object({
	query: z.string().min(1),
	qty: z.number().positive().nullable(),
	unit: z.enum(['l', 'kg', 'pcs', 'case', 'sales']).nullable(),
	constraints: z.array(z.string()).default([]),
	searchFi: z.array(z.string()).default([]),
	variant: z.string().nullable().optional()
});
const LlmOut = z.object({
	items: z.array(LlmItem).max(12),
	deliverBy: z.string().nullable().optional(),
	ambiguities: z.array(z.string()).default([])
});

const SYSTEM = `You turn a professional kitchen's purchase request (English or Finnish) into JSON for a Finnish food wholesaler's catalogue.
Return only JSON: {"items":[{"query":string,"qty":number|null,"unit":"l"|"kg"|"pcs"|"case"|"sales"|null,"constraints":string[],"searchFi":string[],"variant":string|null}],"deliverBy":"YYYY-MM-DD"|null,"ambiguities":string[]}.
- qty in the unit given; convert dl→l and g→kg. "case"/"laatikko"/"KI" = case. No unit: "sales". No quantity: null.
- constraints from: lactose_free, organic, finnish, gluten_free.
- searchFi: 1-3 Finnish catalogue words for the product, base form (maito, peruna, voi, kerma, laktoositon).
- variant: a named product variant (e.g. "whole", "skimmed", "unsalted") or null.
- A dish with a count and no unit ("10000 bolognese pasta", "200 portions of lasagne") is portions to serve, not packs: one item, query the dish name, qty the count, unit "sales"; the server prices the dish itself.
- A ratio of one ingredient ("half beef, the other half mixed", "half only cow and other half half") describes that ingredient's composition: never a separate item, never an ambiguity.
- Never invent a quantity, product or date. Put anything unclear in ambiguities.`;

function constraintKey(s: string): ConstraintKey | null {
	const k = s.toLowerCase().replace(/[\s-]+/g, '_');
	return (
		(['lactose_free', 'organic', 'finnish', 'gluten_free'] as const).find((c) => c === k) ?? null
	);
}

/** Maps one model item onto the lexicon, so ranking uses the same categories and defaults as the rules. */
function fromLlmItem(it: z.infer<typeof LlmItem>): Omit<ParsedItem, 'id'> {
	const words = [
		...it.query.toLowerCase().split(/\s+/),
		...it.searchFi.map((w) => w.toLowerCase())
	];
	const product = words.map(productOf).find(Boolean) ?? null;
	const constraints = it.constraints.map(constraintKey).filter((c): c is ConstraintKey => !!c);
	const variant = variantIn(product, [
		...(it.variant ?? '').toLowerCase().split(/\s+/),
		...it.query.toLowerCase().split(/\s+/)
	]);
	const ambiguities: string[] = [];
	if (it.qty === null) ambiguities.push('no quantity given: how much?');
	if (!product)
		ambiguities.push(
			`"${it.query}" is not in my word list: searched with the model's Finnish words`
		);
	const search = buildSearch(
		product ? product.search : (it.searchFi[0] ?? it.query),
		constraints,
		variant
	);
	return {
		text: it.query,
		query: it.query,
		product: product?.key ?? null,
		search,
		qty: it.qty,
		unit: it.qty === null ? null : (it.unit ?? 'sales'),
		constraints,
		variant,
		ambiguities
	};
}

const label = (c: ConstraintKey) => CONSTRAINTS.find((x) => x.key === c)!.label;

/** Every way the model's item differs from the rules' reading of the same words. */
export function sameItem(a: Omit<ParsedItem, 'id'>, b: Omit<ParsedItem, 'id'>): string[] {
	const out: string[] = [];
	if (a.qty !== b.qty || a.unit !== b.unit)
		out.push(
			`${a.query}: the model read ${a.qty ?? '?'} ${a.unit ?? ''}, the rules ${b.qty ?? '?'} ${b.unit ?? ''}`
		);
	if (a.product !== b.product)
		out.push(`${a.query}: the model and the rules read different products`);
	const missing = b.constraints.filter((c) => !a.constraints.includes(c));
	const extra = a.constraints.filter((c) => !b.constraints.includes(c));
	if (missing.length)
		out.push(`${a.query}: the model read no ${missing.map(label).join(', ')}, the rules did`);
	if (extra.length)
		out.push(`${a.query}: the model read ${extra.map(label).join(', ')}, the rules did not`);
	return out;
}

/** The rules item a model item describes: same product, else shared words, else the only one. */
function matchRules(
	m: Omit<ParsedItem, 'id'>,
	rules: ParsedItem[],
	used: Set<string>,
	single: boolean
): ParsedItem | null {
	const free = rules.filter((r) => !used.has(r.id));
	if (m.product) {
		const r = free.find((r) => r.product === m.product);
		if (r) return r;
	}
	const words = m.query
		.toLowerCase()
		.split(/[^\p{L}\d]+/u)
		.filter((w) => w.length >= 3);
	const r = free.find((r) => words.some((w) => r.text.toLowerCase().includes(w)));
	if (r) return r;
	return single && free.length === 1 ? free[0] : null;
}

/**
 * Constraints the chef typed are never lost to the model: the rules read them from the raw words,
 * they are added to the model's item with the search words they bring, and the item says so.
 */
function reconcile(
	m: Omit<ParsedItem, 'id'>,
	r: ParsedItem | null
): Omit<ParsedItem, 'id'> & { id?: string } {
	if (r?.unitToken)
		// The words named a unit the request can't order in: the model's guess at a quantity is not used.
		m = {
			...m,
			qty: null,
			unit: null,
			unitToken: r.unitToken,
			ambiguities: [
				...m.ambiguities.filter((a) => !/^no quantity/.test(a)),
				...r.ambiguities.filter((a) => a.includes(r.unitToken!))
			]
		};
	if (r?.brand && !m.brand)
		m = {
			...m,
			brand: r.brand,
			query: m.query.toLowerCase().includes(r.brand.toLowerCase())
				? m.query
				: `${r.brand} ${m.query}`,
			search: [`${r.brand.toLowerCase()} ${m.search[0] ?? ''}`.trim(), ...m.search],
			ambiguities: [
				...m.ambiguities,
				`the model dropped the brand ${r.brand}: kept from your words`
			]
		};
	if (r?.variant && !m.variant) m = { ...m, variant: r.variant };
	const typed = r?.constraints ?? constraintsIn(m.query);
	const dropped = typed.filter((c) => !m.constraints.includes(c));
	if (!dropped.length) return r ? { ...m, id: r.id } : m;
	const constraints = [...m.constraints, ...dropped];
	const words = dropped.map(label).join(' ');
	return {
		...m,
		...(r ? { id: r.id } : {}),
		constraints,
		search: buildSearch(m.search.at(-1) ?? m.query, constraints, m.variant),
		query: m.query.toLowerCase().includes(words.toLowerCase()) ? m.query : `${words} ${m.query}`,
		ambiguities: [
			...m.ambiguities,
			`the model dropped ${dropped.map(label).join(', ')}: kept from your words`
		]
	};
}

export interface ParseOptions {
	today: string;
	/** Absent or fixture: rules only. */
	llm?: Llm | null;
	llmKind?: ParsedRequest['parser']['kind'];
	/** A reviewer's critique of the previous parse, for the model's one retry (the rules ignore it). */
	feedback?: string;
}

/** Parses with the model when one is configured, else (or on failure) with the rules. */
export async function parseRequest(text: string, o: ParseOptions): Promise<ParsedRequest> {
	const t0 = performance.now();
	const rules = parseRules(text, o.today);
	const rulesOut = (fallback?: string): ParsedRequest => ({
		...rules,
		parser: {
			kind: 'rules',
			model: 'rules',
			latencyMs: Math.round(performance.now() - t0),
			...(fallback ? { fallback } : {})
		}
	});
	if (!o.llm || !o.llmKind || o.llmKind === 'fixture' || o.llmKind === 'rules') return rulesOut();

	try {
		const r = await o.llm.generate({
			system: SYSTEM,
			prompt: `Today is ${weekdayName(o.today)} ${o.today} (Europe/Helsinki).\nRequest: ${text}${o.feedback ? `\nA reviewer found this in your previous parse; fix it: ${o.feedback.slice(0, 600)}` : ''}`,
			maxTokens: 600,
			json: true
		});
		const raw = r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
		const parsed = LlmOut.safeParse(JSON.parse(raw));
		if (!parsed.success) return rulesOut(`the model's JSON did not match the schema`);
		const read = parsed.data.items.map(fromLlmItem);
		if (read.length === 0) return rulesOut('the model found no item');
		const used = new Set<string>();
		const pairs = read.map((m) => {
			const r = matchRules(m, rules.items, used, read.length === 1);
			if (r) used.add(r.id);
			return { r, m: reconcile(m, r) };
		});
		const items = withIds(pairs.map((p) => p.m));

		const ambiguities = [...rules.ambiguities.filter((a) => !a.startsWith('no item found'))];
		ambiguities.push(...parsed.data.ambiguities.map((a) => `model: ${a}`));
		// Dates: the rules resolve against the simulator clock; the model's date only fills a gap.
		let { deliverBy, deliverBySource } = rules;
		const md = parsed.data.deliverBy;
		if (
			rules.deliverBySource === 'default' &&
			// Words the rules read as a date that does not exist are never replaced by the model's guess.
			rules.deliverByText === null &&
			md &&
			realDate(md) &&
			md >= o.today
		) {
			deliverBy = md;
			deliverBySource = 'request';
			const i = ambiguities.findIndex((a) => a.startsWith('no delivery date given'));
			if (i >= 0)
				ambiguities.splice(i, 1, `date ${day(md)} read by the model only; the rules found none`);
		} else if (md && md !== rules.deliverBy && rules.deliverBySource === 'request')
			ambiguities.push(
				`the model read the date as ${day(md)}; using ${day(rules.deliverBy)} from the clock`
			);

		if (rules.items.length !== items.length)
			ambiguities.push(
				`the model found ${items.length} item(s), the rules ${rules.items.length}: check the list`
			);
		items.forEach((it, i) => {
			const r = pairs[i].r;
			if (r) it.ambiguities.push(...sameItem(it, r));
		});

		return {
			...rules,
			items,
			deliverBy,
			deliverBySource,
			ambiguities,
			parser: {
				kind: o.llmKind,
				model: r.model,
				latencyMs: Math.round(performance.now() - t0),
				tokens: r.tokens
			}
		};
	} catch (e) {
		return rulesOut(`model call failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
	}
}
