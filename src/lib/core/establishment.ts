/**
 * Joining as an establishment (D15): the words a kitchen's card shows, and the rules that map a chef's own
 * description to the nearest seeded profile. Pure: the live path asks a model first and falls back to `matchByRules`
 * when the model's answer isn't a seeded kitchen. A description becomes the kitchen's notes; it never changes a rule.
 */
import type { Criterion, Kitchen } from './contracts';

const KIND_WORDS: Record<string, string> = {
	city_hotel: 'City hotel',
	lunch_restaurant: 'Lunch restaurant',
	public_central_kitchen: 'Public central kitchen',
	a_la_carte_restaurant: 'À la carte restaurant',
	care_home_kitchen: 'Care home kitchen',
	cafe: 'Café',
	ski_resort_hotel: 'Ski resort hotel'
};

const SIZE_WORDS: Record<string, string> = {
	breakfastCovers: 'breakfasts',
	bistroCovers: 'bistro covers',
	lunchCovers: 'lunches a day',
	dinnerCovers: 'dinners',
	restaurantCovers: 'restaurant covers',
	mealsPerDay: 'meals a day',
	residents: 'residents',
	coffeesPerDay: 'coffees a day',
	seats: 'seats',
	rooms: 'rooms'
};

const CRITERION_WORDS: Record<Criterion, string> = {
	price: 'price',
	reliability: 'reliable delivery',
	finnish: 'Finnish origin',
	carbon: 'low carbon',
	organic: 'organic'
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_WORDS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type RuleKey =
	| 'free_from'
	| 'origin_required'
	| 'origin_preferred'
	| 'tender_list'
	| 'unknown_allergens'
	| 'cap';

export interface EstablishmentCard {
	id: string;
	/** Without the seed's "(fictional)". */
	name: string;
	type: string;
	city: string;
	/** "Deliveries Mon–Sat · 300 breakfasts, 80 bistro covers". */
	rhythm: string;
	/** The two heaviest ranking weights, as words: "Reliable delivery first, then price". */
	prefers: string;
	/** Hard rules from the mandate and constraints, each with an icon key. */
	rules: { key: RuleKey; label: string }[];
}

/** "Mon–Sat" for a run of consecutive days, else "Mon, Wed, Fri". */
export function deliveryDaysWords(days: readonly string[]): string {
	const idx = DAYS.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
	if (!idx.length) return 'no fixed days';
	const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
	if (run && idx.length >= 3) return `${DAY_WORDS[idx[0]]}–${DAY_WORDS[idx.at(-1)!]}`;
	return idx.map((i) => DAY_WORDS[i]).join(', ');
}

const euros = (cents: number) => `€${Math.round(cents / 100).toLocaleString('en-GB')}`;

export function establishmentCard(k: Kitchen): EstablishmentCard {
	const size = Object.entries(k.size)
		.filter(([key]) => key !== 'rooms' || Object.keys(k.size).length === 1)
		.slice(0, 2)
		.map(([key, n]) => `${n.toLocaleString('en-GB')} ${SIZE_WORDS[key] ?? key}`);
	const top = (Object.entries(k.weights) as [Criterion, number][])
		.filter(([, w]) => w > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 2)
		.map(([c]) => CRITERION_WORDS[c]);
	const prefers = top.length
		? `${top[0][0].toUpperCase()}${top[0].slice(1)} first${top[1] ? `, then ${top[1]}` : ''}`
		: 'No ranking preference';

	const c = k.constraints;
	const rules: EstablishmentCard['rules'] = [];
	for (const a of c.allergens.freeFrom)
		rules.push({ key: 'free_from', label: `${a[0]}${a.slice(1).toLowerCase()}-free house` });
	const required = c.origin.filter((o) => o.rule === 'require');
	const preferred = c.origin.filter((o) => o.rule === 'prefer');
	if (required.length)
		rules.push({
			key: 'origin_required',
			label: `Finnish ${required.map((o) => o.categoryGroup).join(', ')} only`
		});
	if (preferred.length)
		rules.push({
			key: 'origin_preferred',
			label: `Finnish ${preferred.map((o) => o.categoryGroup).join(', ')} first`
		});
	if (c.tenderListOnly) rules.push({ key: 'tender_list', label: 'Tender list only' });
	if (c.allergens.unknownCounts === 'reject')
		rules.push({ key: 'unknown_allergens', label: 'No product without allergen data' });
	rules.push({ key: 'cap', label: `Orders alone up to ${euros(k.mandate.orderCapCents)}` });

	return {
		id: k.id,
		name: k.name.replace(/\s*\(fictional\)\s*$/, ''),
		type: KIND_WORDS[k.kind] ?? k.kind.replaceAll('_', ' '),
		city: k.city,
		rhythm: `Deliveries ${deliveryDaysWords(k.deliveryDays)}${size.length ? ` · ${size.join(', ')}` : ''}`,
		prefers,
		rules
	};
}

/**
 * Words that point at a kind of kitchen, English and Finnish, lower case. `weight` 2 names the kind outright;
 * 1 is a hint. Matched on word starts, so "hotelli" matches "hotel" and "koulut" matches "koulu".
 */
const CUES: Record<string, [string, number][]> = {
	city_hotel: [
		['hotel', 2],
		['hotelli', 2],
		['breakfast', 1],
		['aamiai', 1],
		['rooms', 1],
		['conference', 1],
		['buffet', 1]
	],
	ski_resort_hotel: [
		['ski', 2],
		['laskette', 2],
		['lapland', 2],
		['lappi', 2],
		['levi', 2],
		['fell', 1],
		['tunturi', 2],
		['resort', 1],
		['season', 1]
	],
	lunch_restaurant: [
		['lunch', 2],
		['lounas', 2],
		['canteen', 1],
		['office', 1],
		['workers', 1],
		['henkilöstö', 1],
		['weekday', 1]
	],
	public_central_kitchen: [
		['school', 2],
		['koulu', 2],
		['daycare', 2],
		['päiväkoti', 2],
		['päiväkodi', 2],
		['municipal', 2],
		['kunta', 1],
		['kunnan', 2],
		['central kitchen', 2],
		['keskuskeittiö', 2],
		['public', 1],
		['tender', 1],
		['kilpailutus', 1],
		['pupils', 1],
		['oppilai', 1]
	],
	a_la_carte_restaurant: [
		['à la carte', 2],
		['a la carte', 2],
		['fine dining', 2],
		['dinner', 1],
		['bistro', 1],
		['tasting', 1],
		['wine', 1],
		['restaurant', 1],
		['ravintola', 1]
	],
	care_home_kitchen: [
		['care home', 2],
		['nursing', 2],
		['elderly', 2],
		['hoivakoti', 2],
		['palvelutalo', 2],
		['vanhus', 2],
		['hospital', 2],
		['sairaala', 2],
		['residents', 1],
		['asukka', 1],
		['texture', 1],
		['clinical', 1],
		['lactose', 1],
		['laktoosi', 1]
	],
	cafe: [
		['café', 2],
		['cafe', 2],
		['kahvila', 2],
		['coffee', 1],
		['kahvi', 1],
		['bakery', 1],
		['leipomo', 1],
		['pastr', 1],
		['bun', 1],
		['pulla', 1]
	]
};

/** Small mobile or counter businesses: none is seeded, the café is the nearest in size and storage. */
const NEAREST_SMALL = [
	'food truck',
	'truck',
	'street food',
	'kiosk',
	'kioski',
	'stand',
	'market stall',
	'pop-up'
];

export interface EstablishmentMatch {
	kitchenId: string;
	/** One sentence, shown to the chef: what matched, or why this is only the nearest. */
	why: string;
	/** The chef's words, kept as the kitchen's notes (they never change a rule). */
	notes: string;
	/** True when the description named this kind of kitchen; false = the nearest of what is seeded. */
	close: boolean;
	source: 'rules' | 'gemini';
}

const cueHit = (text: string, cue: string) =>
	new RegExp(`(^|[^\\p{L}])${cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text);

/** The chef's description, tidied for keeping: one paragraph, at most 500 characters. */
export function notesOf(text: string): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** The nearest seeded kitchen by the description's words. Never empty: with no cue at all, the nearest by size. */
export function matchByRules(text: string, kitchens: readonly Kitchen[]): EstablishmentMatch {
	const notes = notesOf(text);
	const byKind = new Map(kitchens.map((k) => [k.kind, k]));
	const scored = Object.entries(CUES)
		.filter(([kind]) => byKind.has(kind))
		.map(([kind, cues]) => {
			const hits = cues.filter(([cue]) => cueHit(notes, cue));
			return { kind, hits: hits.map(([c]) => c), score: hits.reduce((s, [, w]) => s + w, 0) };
		})
		.sort((a, b) => b.score - a.score);
	const best = scored[0];
	if (best && best.score >= 2) {
		const k = byKind.get(best.kind)!;
		const card = establishmentCard(k);
		return {
			kitchenId: k.id,
			why: `You mentioned ${best.hits.map((h) => `“${h}”`).join(', ')}: closest is ${card.name}, a ${card.type.toLowerCase()}.`,
			notes,
			close: true,
			source: 'rules'
		};
	}
	const small = NEAREST_SMALL.find((c) => cueHit(notes, c));
	const nearest =
		(small ? byKind.get('cafe') : undefined) ??
		(best && best.score > 0 ? byKind.get(best.kind) : undefined) ??
		bySize(notes, kitchens) ??
		kitchens[0];
	const card = establishmentCard(nearest);
	return {
		kitchenId: nearest.id,
		why: `None of our kitchens is quite like yours${small ? ` (no ${small} yet)` : ''}. The nearest is ${card.name}, a ${card.type.toLowerCase()}; your description stays as its notes.`,
		notes,
		close: false,
		source: 'rules'
	};
}

/** With a number in the text ("about 400 meals"), the kitchen whose biggest daily count is nearest to it. */
function bySize(text: string, kitchens: readonly Kitchen[]): Kitchen | undefined {
	const n = Number(text.match(/\b(\d{2,5})\b/)?.[1]);
	if (!n) return undefined;
	const daily = (k: Kitchen) =>
		Math.max(
			...Object.entries(k.size)
				.filter(([key]) => key !== 'rooms')
				.map(([, v]) => v),
			0
		);
	return [...kitchens].sort((a, b) => Math.abs(daily(a) - n) - Math.abs(daily(b) - n))[0];
}

/** The model's prompt: the seeded kitchens as cards, and the one JSON shape it may answer with. */
export function matchPrompt(
	text: string,
	kitchens: readonly Kitchen[]
): { system: string; prompt: string } {
	return {
		system:
			'You map a professional kitchen\'s description to the nearest of a fixed list of example kitchens. Answer only JSON: {"kitchenId": one of the listed ids, "why": one plain sentence for the chef naming what in their words matched, or saying honestly that none is close and why this one is nearest, "close": true if the description is the same kind of kitchen, else false}. Never invent an id.',
		prompt: JSON.stringify({
			description: notesOf(text),
			kitchens: kitchens.map((k) => {
				const c = establishmentCard(k);
				return {
					id: k.id,
					type: c.type,
					rhythm: c.rhythm,
					prefers: c.prefers,
					rules: c.rules.map((r) => r.label)
				};
			})
		})
	};
}

/** The model's answer if it names a seeded kitchen and gives a reason; otherwise null (the rules decide). */
export function readModelMatch(
	raw: string,
	text: string,
	kitchens: readonly Kitchen[]
): EstablishmentMatch | null {
	try {
		const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as {
			kitchenId?: unknown;
			why?: unknown;
			close?: unknown;
		};
		if (typeof j.kitchenId !== 'string' || !kitchens.some((k) => k.id === j.kitchenId)) return null;
		if (typeof j.why !== 'string' || j.why.trim().length < 8) return null;
		return {
			kitchenId: j.kitchenId,
			why: j.why.trim().slice(0, 240),
			notes: notesOf(text),
			close: j.close !== false,
			source: 'gemini'
		};
	} catch {
		return null;
	}
}
