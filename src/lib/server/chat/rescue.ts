/**
 * Never end a turn on "I could not" (D33 addendum). When an order can't go ahead (an unknown word, a typo, nothing
 * buyable that day, a confused follow-up), the chat gives the likeliest reading and the ways on as chips: the closest
 * catalogue products with the amount kept, the next days that work, or what the last step did. A chip's value is
 * `say:<words>`, the chef's next message. S1's tolerant search (corrected, matches) sharpens the reading when present.
 */
import type { Product } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { readableName } from '$lib/ui/format';
import { parseRules } from '$lib/server/request/parse';

export interface Rescue {
	text: string;
	options: { label: string; value: string }[];
}

/** Words a chef types for a food, with the catalogue's Finnish searches; typos map to the word they meant. */
const SYNONYMS: {
	words: RegExp;
	said: string;
	search: string[];
	/** Names that only look like the food (a beefsteak tomato for "steak", baby food for "beef"). */
	not?: RegExp;
	dish?: true;
	/** Grams per portion as bought, to say what N portions come to. */
	gPerPortion?: number;
}[] = [
	{
		words: /\b(st(?:r)?e?aks?|stakes?|streaks?|pihvi\p{L}*|entrecote|sirloin|ribeye)\b/iu,
		said: 'steaks',
		search: ['naudan pihvi', 'entrecote', 'sisäfile', 'pihvi'],
		not: /tomaatti|kalkkuna|broileri|kana|kasvis|soija|kala|lohi|piltti/i,
		dish: true,
		gPerPortion: 200
	},
	{
		words: /\b(cow(?: meat)?|beef|nauta\p{L}*|naudan\p{L}*)\b/iu,
		said: 'beef',
		search: ['naudan', 'nauta', 'naudan jauheliha'],
		not: /piltti|lastenateria|kasvis|kebab|ateria/i
	},
	{ words: /\b(pork|pig|porsa\p{L}*|sian\p{L}*)\b/iu, said: 'pork', search: ['porsaan', 'sian'] },
	{
		words: /\b(chicken|chiken|broiler\p{L}*|kana\p{L}*)\b/iu,
		said: 'chicken',
		search: ['broileri', 'kana']
	},
	{
		words: /\b(pasta|spagh?etti|penne|fusilli|makaroni)\b/iu,
		said: 'pasta',
		search: ['pasta', 'spagetti', 'penne'],
		dish: true,
		gPerPortion: 100
	},
	{ words: /\b(fish|kala)\b/iu, said: 'fish', search: ['kala', 'lohi', 'kuha'] }
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Words that name a food this knows (a synonym or a typo of one): worth a rescue rather than a generic question. */
export function namesFood(text: string): boolean {
	return SYNONYMS.some((s) => s.words.test(text));
}

/** The likeliest reading of an order that could not go ahead, and its ways on as chips. */
export async function rescueOrder(
	goal: string,
	ctx: CallContext,
	handlers: ToolHandlers,
	today: string,
	why?: string
): Promise<Rescue> {
	const read = parseRules(goal, today);
	const item = read.items[0];
	const qty = item?.qty ?? null;
	const unit = item?.unit && item.unit !== 'sales' ? item.unit : null;
	const syn = SYNONYMS.find((s) => s.words.test(goal));
	const word = syn?.said ?? item?.query ?? goal.replace(/\d+\s*\w*/g, '').trim();
	const typed = goal.match(syn?.words ?? /^$/)?.[0]?.toLowerCase();
	const corrected = syn && typed && !typed.startsWith(syn.said.slice(0, 4)) ? syn.said : null;

	// Nothing buyable for that day: the next days as chips, the order kept.
	if (why && /can(?:'t)? be bought for|no delivery of|can't deliver any|too little/.test(why)) {
		const days = nextDays(read.deliverBy, 2);
		const base = goal.replace(/\b(for|on|by)\s+\S+(\s+\d{1,2}\s+\w{3})?\s*$/i, '').trim();
		return {
			text: `${why.replace(/^Not ordered: /, '').replace(/\.$/, '')}. Another day may work:`,
			options: days.map((d) => ({ label: `${base} for ${d}`, value: `say:${base} for ${d}` }))
		};
	}

	// The closest catalogue products, the amount kept (or asked).
	let hits: Product[] = [];
	for (const q of syn?.search ?? [word]) {
		const r = await handlers.search_products(ctx, { query: q, limit: 8 }).catch(() => null);
		if (r && r.ok) {
			const out = r.value as { products?: Product[] };
			hits = (out.products ?? []).filter((p) => !syn?.not?.test(p.nameFi)).slice(0, 3);
		}
		if (hits.length) break;
	}
	const amount =
		qty !== null && unit
			? `${qty} ${unit}`
			: qty !== null
				? `${qty} kg`
				: syn?.dish
					? '10 kg'
					: '5 kg';
	const kgFor =
		qty !== null && syn?.gPerPortion && hits.length
			? Math.round((qty * syn.gPerPortion) / 100) / 10
			: null;
	const lead = corrected ? `Did you mean ${corrected}? ` : '';
	const ask =
		qty !== null && !unit
			? syn?.dish
				? `${qty} portions${kgFor !== null ? ` (about ${kgFor} kg)` : ''} or ${qty} kg?`
				: `${qty} kg, ${qty} packs or something else?`
			: qty === null
				? 'How much?'
				: '';
	if (!hits.length)
		return {
			text: `${lead}I don't see ${word} in Valio's catalogue under that name. Try the Finnish word or a brand, or plan a dish:`,
			options: [
				{ label: `a menu with ${word}`, value: `say:a menu with ${word} for 40 guests` },
				{ label: 'What can I order?', value: 'say:what needs my decision?' }
			]
		};
	return {
		text: `${lead}The closest in Valio's catalogue for ${word}: ${plural(hits.length, 'product')}.${ask ? ` ${ask}` : ''}`,
		options: [
			// "100 pasta": the likeliest reading first, the portions said in kilos of the top product.
			...(qty !== null && !unit && syn?.dish && kgFor !== null
				? [
						{
							label: `${qty} portions (~${kgFor} kg)`,
							value: `say:${kgFor} kg ${readableName(hits[0].nameShort?.value ?? hits[0].nameFi)}`
						}
					]
				: []),
			...hits.map((p) => {
				const name = readableName(p.nameShort?.value ?? p.nameFi);
				return { label: `${amount} ${name}`, value: `say:${amount} ${name}` };
			})
		].slice(0, 4)
	};
}

/** The next n weekdays after a date, as "Mon 14 Dec". */
function nextDays(from: string, n: number): string[] {
	const out: string[] = [];
	const d = new Date(`${from}T12:00:00Z`);
	while (out.length < n) {
		d.setUTCDate(d.getUTCDate() + 1);
		if (d.getUTCDay() === 0) continue;
		out.push(
			d.toLocaleDateString('en-GB', {
				weekday: 'short',
				day: 'numeric',
				month: 'short',
				timeZone: 'UTC'
			})
		);
	}
	return out;
}
