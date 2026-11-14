/**
 * Request text → structured purchase request. Two parsers, one output shape:
 * - rules: deterministic, no network; good for Valio's own example and close variants (EN + FI).
 * - gemini: Flash-Lite with JSON output through the Llm port (traced); dates are still resolved by
 *   the rules against the simulator clock, and any disagreement with the rules is shown, not hidden.
 * Nothing ambiguous is guessed silently: each guess lands in `ambiguities`.
 */
import { z } from 'zod';
import type { Llm } from '$lib/core/ports';
import { findDate, weekdayName, weekdayOf } from './dates';
import {
	CONSTRAINTS,
	NUMBER_WORDS,
	PRODUCTS,
	UNITS,
	type ConstraintKey,
	type ProductWord,
	type ReqUnit
} from './lexicon';

export interface ParsedItem {
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
	variant: { token: string; label: string } | null;
	ambiguities: string[];
}

export interface ParsedRequest {
	text: string;
	items: ParsedItem[];
	deliverBy: string;
	deliverByText: string | null;
	deliverBySource: 'request' | 'default';
	notes: string[];
	/** Request-level questions (date, disagreements); item questions live on the item. */
	ambiguities: string[];
	answered?: { item: number; qty?: number; unit?: ReqUnit; productId?: string }[];
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

function buildSearch(product: ProductWord | null, constraints: ConstraintKey[], rest: string[]) {
	const cwords = CONSTRAINTS.filter((c) => constraints.includes(c.key) && c.search).map(
		(c) => c.search!
	);
	const typed = product ? product.search : rest.join(' ');
	return typed ? [...new Set([[typed, ...cwords].join(' '), typed])] : [];
}

/** One item phrase → an item. */
export function parseItem(chunk: string, finnish: boolean): ParsedItem | null {
	const ambiguities: string[] = [];
	let s = chunk.toLowerCase();
	// "1000l" → "1000 l", "2x" → "2 x"
	s = s.replace(/(\d)([a-zäöå×])/giu, '$1 $2');

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
	if (qty !== null && afterWords.length) {
		const u = unitOf(afterWords[0]);
		if (u) {
			unit = u.unit;
			qty = +(qty * u.factor).toFixed(6);
			unitWordAt = words.indexOf(afterWords[0].replace(/^[,.:]+|[,.:]+$/g, ''));
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

	let variant: ParsedItem['variant'] = null;
	if (product?.variants) {
		const all = `${words.join(' ')}`;
		for (const v of product.variants)
			if (v.words.some((w) => all.split(/\s+/).includes(w)))
				variant = { token: v.token, label: v.label };
	}
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
	if (qty === null) ambiguities.push('no quantity given: how much?');
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

	return {
		text: chunk.trim(),
		query,
		product: product?.key ?? null,
		search: buildSearch(product, constraints, leftovers),
		qty,
		unit,
		constraints,
		variant,
		ambiguities
	};
}

/** The deterministic parser. `today` is the simulator clock's Helsinki date. */
export function parseRules(text: string, today: string): Omit<ParsedRequest, 'parser'> {
	const notes: string[] = [];
	const ambiguities: string[] = [];
	const date = findDate(text, today);
	const body = date ? text.replace(date.text, ' ') : text;
	const finnish = looksFinnish(text);
	const items = splitItems(body)
		.map((c) => parseItem(c, finnish))
		.filter((i): i is ParsedItem => i !== null);

	let deliverBy = today;
	if (date) {
		deliverBy = date.iso;
		if (date.note) ambiguities.push(`"${date.text}": ${date.note}`);
		if (date.iso < today) ambiguities.push(`"${date.text}" is in the past`);
	} else ambiguities.push(`no delivery date given: using today, ${weekdayName(today)} ${today}`);
	if (weekdayOf(deliverBy) === 0) notes.push(`${deliverBy} is a Sunday`);
	if (items.length === 0) ambiguities.push('no item found: try "200 kg potatoes by Friday"');

	return {
		text,
		items,
		deliverBy,
		deliverByText: date?.text ?? null,
		deliverBySource: date ? 'request' : 'default',
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
- Never invent a quantity, product or date. Put anything unclear in ambiguities.`;

function constraintKey(s: string): ConstraintKey | null {
	const k = s.toLowerCase().replace(/[\s-]+/g, '_');
	return (
		(['lactose_free', 'organic', 'finnish', 'gluten_free'] as const).find((c) => c === k) ?? null
	);
}

/** Maps one model item onto the lexicon, so ranking uses the same categories and defaults as the rules. */
function fromLlmItem(it: z.infer<typeof LlmItem>): ParsedItem {
	const words = [
		...it.query.toLowerCase().split(/\s+/),
		...it.searchFi.map((w) => w.toLowerCase())
	];
	const product = words.map(productOf).find(Boolean) ?? null;
	const constraints = it.constraints.map(constraintKey).filter((c): c is ConstraintKey => !!c);
	const variantDef = product?.variants?.find((v) =>
		v.words.some((w) => (it.variant ?? '').toLowerCase().includes(w))
	);
	const ambiguities: string[] = [];
	if (it.qty === null) ambiguities.push('no quantity given: how much?');
	if (!product)
		ambiguities.push(
			`"${it.query}" is not in my word list: searched with the model's Finnish words`
		);
	const cwords = CONSTRAINTS.filter((c) => constraints.includes(c.key) && c.search).map(
		(c) => c.search!
	);
	const base = product ? product.search : (it.searchFi[0] ?? it.query);
	const search = [...new Set([[base, ...cwords].join(' '), base])];
	return {
		text: it.query,
		query: it.query,
		product: product?.key ?? null,
		search,
		qty: it.qty,
		unit: it.qty === null ? null : (it.unit ?? 'sales'),
		constraints,
		variant: variantDef ? { token: variantDef.token, label: variantDef.label } : null,
		ambiguities
	};
}

function sameItem(a: ParsedItem, b: ParsedItem): string | null {
	if (a.qty !== b.qty || a.unit !== b.unit)
		return `${a.query}: the model read ${a.qty ?? '?'} ${a.unit ?? ''}, the rules ${b.qty ?? '?'} ${b.unit ?? ''}`;
	if (a.product !== b.product) return `${a.query}: the model and the rules read different products`;
	return null;
}

export interface ParseOptions {
	today: string;
	/** Absent or fixture: rules only. */
	llm?: Llm | null;
	llmKind?: ParsedRequest['parser']['kind'];
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
			prompt: `Today is ${weekdayName(o.today)} ${o.today} (Europe/Helsinki).\nRequest: ${text}`,
			maxTokens: 600,
			json: true
		});
		const raw = r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
		const parsed = LlmOut.safeParse(JSON.parse(raw));
		if (!parsed.success) return rulesOut(`the model's JSON did not match the schema`);
		const items = parsed.data.items.map(fromLlmItem);
		if (items.length === 0) return rulesOut('the model found no item');

		const ambiguities = [...rules.ambiguities.filter((a) => !a.startsWith('no item found'))];
		ambiguities.push(...parsed.data.ambiguities.map((a) => `model: ${a}`));
		// Dates: the rules resolve against the simulator clock; the model's date only fills a gap.
		let { deliverBy, deliverBySource } = rules;
		const md = parsed.data.deliverBy;
		if (
			rules.deliverBySource === 'default' &&
			md &&
			/^\d{4}-\d{2}-\d{2}$/.test(md) &&
			md >= o.today
		) {
			deliverBy = md;
			deliverBySource = 'request';
			const i = ambiguities.findIndex((a) => a.startsWith('no delivery date given'));
			if (i >= 0)
				ambiguities.splice(i, 1, `date ${md} read by the model only; the rules found none`);
		} else if (md && md !== rules.deliverBy && rules.deliverBySource === 'request')
			ambiguities.push(`the model read the date as ${md}; using ${rules.deliverBy} from the clock`);

		if (rules.items.length !== items.length)
			ambiguities.push(
				`the model found ${items.length} item(s), the rules ${rules.items.length}: check the list`
			);
		else
			items.forEach((it, i) => {
				const d = sameItem(it, rules.items[i]);
				if (d) it.ambiguities.push(d);
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
