/**
 * Checkpoint 'request.reading': the reading of a purchase request judged against the chef's words, on every
 * request (page and chat). Deterministic checks first, through the review module (lib/server/review), with an
 * optional rubric score when Decide is live (a score from the offline rules fallback never blocks):
 *  - every number with a unit in the words is an item's quantity with the same physical magnitude (250 ml → 0.25 l);
 *  - an explicit unit the request can't order in blocks with the ask ("I can't order in oz: how much, in kg…");
 *  - every diet or origin word ("laktoositon", "Finnish") is a requirement of an item;
 *  - after lookup, the chosen line's physical amount is within one pack of what was asked.
 * A block is the question to the chef; nothing is looked up or placed past it.
 */
import {
	review,
	type Checkpoint,
	type Finding,
	type ReviewDeps,
	type Verdict
} from '$lib/server/review';
import { num } from '$lib/ui/format';
import {
	BRANDS,
	CONSTRAINTS,
	DIET_UNCHECKABLE,
	PRODUCTS,
	UNITS,
	dietTagsIn,
	hasWord,
	type ConstraintKey
} from './lexicon';
import { constraintsIn, parseNumber, unitPosition } from './parse';

export interface ReadingItem {
	id: string;
	query: string;
	qty: number | null;
	unit: string | null;
	product: string | null;
	/** Hard requirements as read (lactose_free, organic, finnish, gluten_free). */
	requirements: string[];
	/** An explicit unit the request can't order in. */
	unitToken?: string;
	/** The brand kept on the item, when the words named one. */
	brand?: string;
	/** The variant kept on the item ("whole milk"), as its catalogue token. */
	variant?: string | null;
	/** Hard diet asks kept on the item (D16 tags). */
	diet?: string[];
	ambiguities?: string[];
}

/** The chosen line, echoed: what was asked against what one line buys. */
export interface ReadingEcho {
	item: string;
	asked: { value: number; unit: 'kg' | 'l' };
	salesQty: number;
	salesUnit: string;
	/** Physical content of one sales unit, when the product states it. */
	perUnit: { value: number; unit: string } | null;
}

export interface Reading {
	items: ReadingItem[];
	echo?: ReadingEcho[];
	/** Words of the request that are the delivery date (their numbers are not quantities). */
	dateText?: string | null;
}

const label = (c: string) => CONSTRAINTS.find((x) => x.key === c)?.label ?? c;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

/** "250ml" → "250 ml", as the parser reads it. */
const spaced = (t: string) => t.toLowerCase().replace(/(\d)([a-zäöå×])/giu, '$1 $2');

function unitWord(w: string) {
	const k = w.replace(/\.$/, '');
	return UNITS.find((u) => u.forms.includes(k)) ?? null;
}

/** Every number-with-unit in the words, as a magnitude in the request's units (multipacks multiplied). */
export function statedAmounts(
	text: string
): { text: string; value: number; unit: string; unknown?: string }[] {
	let t = spaced(text);
	const out: { text: string; value: number; unit: string; unknown?: string }[] = [];
	for (const m of t.matchAll(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s+([\p{L}.]+)/giu)) {
		const u = unitWord(m[3]);
		const b = parseNumber(m[2]);
		if (u && b)
			out.push({
				text: m[0],
				value: +(Number(m[1]) * b.value * u.factor).toFixed(6),
				unit: u.unit
			});
	}
	t = t.replace(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s+([\p{L}.]+)/giu, ' ');
	for (const m of t.matchAll(
		/(\d{1,3}(?:\s\d{3})+(?![\d,.])|\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:[.,]\d+)?)\s+([\p{L}.]+)/gu
	)) {
		const n = parseNumber(m[1]);
		if (!n) continue;
		const u = unitWord(m[2]);
		if (u) out.push({ text: m[0], value: +(n.value * u.factor).toFixed(6), unit: u.unit });
		else if (
			unitPosition(
				m[2],
				t
					.slice((m.index ?? 0) + m[0].length)
					.split(/\s+/)
					.filter(Boolean)
			)
		)
			out.push({ text: m[0], value: n.value, unit: '?', unknown: m[2].replace(/\.$/, '') });
	}
	return out;
}

const SCORE: Checkpoint<{ text: string }, Reading, null>['score'] = {
	question:
		'Does the reading keep every quantity (same physical amount), unit, product and diet or origin requirement of the request, without inventing any?',
	max: 4,
	pass: 3,
	context: ({ input, output }) =>
		JSON.stringify({
			request: input.text,
			items: output.items.map((i) => ({
				query: i.query,
				qty: i.qty,
				unit: i.unit,
				requirements: i.requirements
			}))
		})
};

export const requestReadingCheckpoint: Checkpoint<{ text: string }, Reading, null> = {
	id: 'request.reading',
	rubric:
		'Each item has the quantity and unit the chef wrote (same physical amount), the product they named, and every diet or origin requirement they stated; nothing ordered is more than one pack over what was asked.',
	check({ input, output }): Finding[] {
		const out: Finding[] = [];
		const body = output.dateText ? input.text.replace(output.dateText, ' ') : input.text;

		// 1. Every number with a unit is an item's quantity with the same magnitude, one item per amount (two "2 kg"
		// asks need two items, never one counted twice); an unknown unit asks.
		const claimed = new Set<number>();
		for (const s of statedAmounts(body)) {
			if (s.unknown) {
				// Answered since (the chef gave the amount in a unit we order in): not asked again.
				if (output.items.some((i) => i.unitToken === s.unknown && i.qty !== null)) continue;
				out.push({
					severity: 'block',
					message: `"${s.text}": I can't order in ${s.unknown}. How much is it, in kg, l, pieces, cases or packs?`
				});
				continue;
			}
			const at = output.items.findIndex(
				(i, k) => !claimed.has(k) && i.qty !== null && i.unit === s.unit && close(i.qty, s.value)
			);
			if (at >= 0) claimed.add(at);
			else
				out.push({
					severity: 'block',
					message: `"${s.text}" is ${num(s.value, 3)} ${s.unit}, but no item was read as that amount (${output.items.map((i) => `${i.qty ?? '?'} ${i.unit ?? ''} ${i.query}`).join('; ')}). How much should I order?`
				});
		}
		for (const i of output.items)
			if (
				i.unitToken &&
				i.qty === null &&
				!out.some((f) => f.message.includes(`order in ${i.unitToken}`))
			)
				out.push({
					severity: 'block',
					message: `I can't order in ${i.unitToken}. How much ${i.query}, in kg, l, pieces, cases or packs?`
				});

		// 2. Every diet or origin word is a requirement of some item.
		const stated = constraintsIn(input.text) as ConstraintKey[];
		const carried = new Set(output.items.flatMap((i) => i.requirements));
		const lost = stated.filter((c) => !carried.has(c));
		if (lost.length)
			out.push({
				severity: 'block',
				message: `The request says ${lost.map(label).join(', ')}, but no item carries it. Which item is it for?`
			});
		// 3. A brand or a variant the words name is kept on an item: "Arla whole milk" is not just "milk".
		for (const b of BRANDS)
			if (hasWord(input.text, b))
				if (!output.items.some((i) => i.brand?.toLowerCase() === b.toLowerCase()))
					out.push({
						severity: 'block',
						message: `The request names ${b}, but no item keeps it. Should it be ${b} only?`
					});
		for (const i of output.items) {
			const lex = PRODUCTS.find((p) => p.key === i.product);
			const said = lex?.variants?.find((v) => v.words.some((w) => hasWord(input.text, w)));
			if (said && i.variant !== said.token)
				out.push({
					severity: 'block',
					message: `The request says "${said.label}" ${i.query}, but the reading kept ${i.variant ? `a different kind` : 'no kind'}. Which ${i.query} is it?`
				});
		}
		// 4. A hard diet ask is a requirement of an item, or the reading stops: a warning never replaces it.
		const carriedDiet = new Set(output.items.flatMap((i) => i.diet ?? []));
		const askedDiet = dietTagsIn(input.text).filter((t) => !carriedDiet.has(t));
		if (askedDiet.length)
			out.push({
				severity: 'block',
				message: `The request says ${askedDiet.join(', ')}, but no item carries it. Which item must be ${askedDiet.join(', ')}?`
			});
		for (const w of DIET_UNCHECKABLE)
			if (hasWord(input.text, w))
				out.push({
					severity: 'block',
					message: `"${w}" can't be checked against Valio's product records here. Order it from a supplier who states it, or remove the word to go on.`
				});

		return out;
	},
	score: SCORE
};

/**
 * The echo of the chosen lines: each buys at most one pack more than was asked. Its own checkpoint, judged after
 * lookup, so the words' checks are not repeated against an empty item list.
 */
export const requestEchoCheckpoint: Checkpoint<{ text: string }, Reading, null> = {
	id: 'request.reading.echo',
	rubric: 'No chosen line buys more than one pack over the amount the chef asked for.',
	check({ output }): Finding[] {
		const out: Finding[] = [];
		for (const e of output.echo ?? []) {
			if (!e.perUnit || e.perUnit.unit !== e.asked.unit) continue;
			const bought = e.salesQty * e.perUnit.value;
			if (bought > e.asked.value * 2 + 1e-9)
				out.push({
					severity: 'block',
					message: `need_rounding_large: ${num(e.asked.value, 3)} ${e.asked.unit} asked → ${num(bought, 3)} ${e.asked.unit} (${num(bought / e.asked.value, 1)}×). Nothing was placed; pick a smaller pack or confirm it.`
				});
			else if (bought - e.asked.value > e.perUnit.value + 1e-9)
				out.push({
					severity: 'block',
					message: `${num(e.asked.value, 3)} ${e.asked.unit} asked → ${num(e.salesQty)} × ${num(e.perUnit.value, 3)} ${e.perUnit.unit} = ${num(bought, 3)} ${e.asked.unit}: more than one pack over. Nothing was placed; check the amount.`
				});
		}
		return out;
	}
};

/** Judge one reading. Deterministic always; the rubric score only with `deps.decide` (capped by its budget). */
export function reviewReading(
	text: string,
	reading: Reading,
	deps: ReviewDeps = {}
): Promise<Verdict> {
	return review(
		reading.echo ? requestEchoCheckpoint : requestReadingCheckpoint,
		{ input: { text }, output: reading, facts: null },
		deps
	);
}

/** A parsed request's items as a reading. */
export function readingOf(p: {
	items: {
		id: string;
		query: string;
		qty: number | null;
		unit: string | null;
		product: string | null;
		constraints: string[];
		unitToken?: string;
		brand?: string;
		variant?: { token: string } | null;
		diet?: string[];
	}[];
	deliverByText?: string | null;
}): Reading {
	return {
		items: p.items.map((i) => ({
			id: i.id,
			query: i.query,
			qty: i.qty,
			unit: i.unit,
			product: i.product,
			requirements: [...i.constraints],
			...(i.unitToken ? { unitToken: i.unitToken } : {}),
			...(i.brand ? { brand: i.brand } : {}),
			variant: i.variant?.token ?? null,
			...(i.diet?.length ? { diet: [...i.diet] } : {})
		})),
		dateText: p.deliverByText ?? null
	};
}
