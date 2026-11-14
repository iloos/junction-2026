import { parseNumber, type ParsedRequest } from '$lib/server/request/parse';
import type { Checkpoint, Finding } from './index';

/**
 * Checkpoint: the request parse (rules or model). Nothing from the chef's words may be lost: every number is
 * an item quantity or part of the date, and every content word lands in some item (its words, query or search
 * terms) or in the date. Dropped words are what make a parse silently wrong, so each one is named.
 */

/** Words that carry no product, quantity or constraint (EN + FI), plus unit words. */
const FUNCTION_WORDS = new Set(
	(
		'i we need needs want please order get buy us me some of the a an and or x for to by on at in with ' +
		'deliver delivered delivery send also more our my tilaa tilaisitko tarvitaan tarvitsen tarvitsemme ' +
		'kiitos tarvis ja sekä myös meille l ltr litre litres liter liters litra litraa dl kg kgs kilo kilos ' +
		'kiloa kilogram kilograms g gram grams grammaa case cases box boxes ki laatikko laatikkoa ' +
		'laatikollista ltk pcs pc piece pieces kpl st kappaletta pack packs pakkaus pakkausta'
	).split(' ')
);

const words = (s: string) =>
	s
		.toLowerCase()
		.split(/[^\p{L}\d.,-]+/u)
		.map((w) => w.replace(/^[.,-]+|[.,-]+$/g, ''))
		.filter(Boolean);

export const requestParseCheckpoint: Checkpoint<{ text: string }, ParsedRequest, null> = {
	id: 'request.parse',
	rubric:
		'Every quantity, unit, product, constraint and date in the request is kept in the parse; nothing is invented; anything guessed is listed as an ambiguity.',
	check({ input, output }): Finding[] {
		const out: Finding[] = [];
		const dateText = (output.deliverByText ?? '').toLowerCase();
		const kept = new Set<string>([
			...words(dateText),
			...output.items.flatMap((i) => [
				...words(i.text),
				...words(i.query),
				...i.search.flatMap(words),
				...(i.product ? [i.product] : []),
				...(i.variant ? words(i.variant.label) : [])
			])
		]);
		const lost = [
			...new Set(
				words(input.text.replace(output.deliverByText ?? '\u0000', ' ')).filter(
					(w) => !FUNCTION_WORDS.has(w) && !/^\d/.test(w) && !kept.has(w)
				)
			)
		];
		if (lost.length)
			out.push({
				severity: 'revise',
				message: `These words of the request are in no item: ${lost.map((w) => `"${w}"`).join(', ')}. Keep each as part of an item or say why it does not matter.`
			});

		const body = input.text.replace(output.deliverByText ?? '\u0000', ' ');
		const numbers = [...body.matchAll(/\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)].map(
			(m) => parseNumber(m[0])?.value ?? Number.NaN
		);
		// A quantity may have been scaled by its unit: 500 g → 0.5 kg, 5 dl / 50 cl → 0.5 l.
		const factors: Record<string, number[]> = { kg: [1, 0.001], l: [1, 0.1, 0.01] };
		const explained = (n: number) =>
			output.items.some(
				(i) =>
					i.qty !== null &&
					(factors[i.unit ?? ''] ?? [1]).some((f) => Math.abs(i.qty! - n * f) < 1e-9)
			);
		// "2 x 10 kg" is one quantity (20 kg); a number an ambiguity names was not dropped silently.
		const products = [...body.matchAll(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/gi)].map(
			(m) => [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]
		);
		const said = [...output.ambiguities, ...output.items.flatMap((i) => i.ambiguities)].join(' ');
		const missing = numbers.filter(
			(n) =>
				!explained(n) &&
				!products.some(([a, b]) => (n === a || n === b) && explained(a * b)) &&
				!said.split(/[^\d.]+/).some((w) => w.replace(/\.$/, '') === String(n))
		);
		if (missing.length)
			out.push({
				severity: 'revise',
				message: `These numbers of the request are no item's quantity: ${missing.join(', ')}.`
			});
		if (output.items.length === 0)
			out.push({ severity: 'revise', message: 'No item was read from the request.' });
		return out;
	},
	score: {
		question:
			'Does the parse keep every quantity, unit, product, constraint and date of the request, without inventing any?',
		max: 4,
		pass: 3,
		context: ({ input, output }) =>
			JSON.stringify({
				request: input.text,
				items: output.items.map((i) => ({
					text: i.text,
					query: i.query,
					qty: i.qty,
					unit: i.unit,
					constraints: i.constraints
				})),
				deliverBy: output.deliverBy,
				ambiguities: output.ambiguities
			})
	}
};
