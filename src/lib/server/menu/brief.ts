/**
 * Event brief from the chef's words, completed by one focused question at a time. Deterministic, no model call:
 * the words fill what they state, each question asks for exactly one missing field, and an answer is keyed by the
 * question's stable id ("brief.guests"), never by its position. Typed requirements ("lactose-free", "6 vegetarians")
 * are fixed by the words: an answer can add requirements, never remove one the chef typed.
 */
import { EventBrief, type EventBrief as EventBriefT } from '$lib/core/contracts';
import type {
	BriefAnswer,
	BriefDraft,
	BriefField,
	BriefQuestion,
	ServiceStyleWord
} from '$lib/ui/request/types';
import { addDays, findDate, realDate, weekdayOf } from '../request/dates';
import { CONSTRAINTS } from '../request/lexicon';
import { coursesIn, guestsIn } from '../request/classify';
import { constraintsIn } from '../request/parse';

const STYLES: { style: ServiceStyleWord; re: RegExp }[] = [
	{ style: 'buffet', re: /(?<![\p{L}])(buffet|noutopöytä\p{L}*|seisova pöytä)(?![\p{L}])/iu },
	{
		style: 'canape',
		re: /(?<![\p{L}])(canap\p{L}*|cocktail|finger food|cocktailpala\p{L}*)(?![\p{L}])/iu
	},
	{ style: 'family', re: /(?<![\p{L}])(family[- ]style|sharing)(?![\p{L}])/iu },
	{
		style: 'plated',
		re: /(?<![\p{L}])(plated|sit[- ]down|served|\d{1,2}[\s-]*courses?|tasting menu|ruokalajia)(?![\p{L}])/iu
	},
	{ style: 'lunch', re: /(?<![\p{L}])(lunch|lounas|lounaa\p{L}*)(?![\p{L}])/iu }
];

/** Requirements beyond the request parser's constraints, with an optional head count ("6 vegetarians"). */
const DIETS: { label: string; re: RegExp }[] = [
	{ label: 'vegetarian', re: /vegetarian\p{L}*|kasvis\p{L}*/iu },
	{ label: 'vegan', re: /vegan\p{L}*|vegaan\p{L}*/iu },
	{ label: 'nut-free', re: /nut[- ]free|no nuts|pähkinätön\p{L}*/iu },
	{ label: 'dairy-free', re: /dairy[- ]free|maidoton\p{L}*/iu },
	{ label: 'halal', re: /halal/iu },
	{ label: 'no pork', re: /no pork|pork[- ]free|sianlihaton/iu }
];

const BUDGET =
	/(?:€\s*(\d[\d\s,.]*\d|\d)|(\d[\d\s,.]*\d|\d)\s*(?:€|eur\b|euros?\b))(\s*(?:per|\/|a)\s*(?:guest|head|person|cover|hlö|henkilö))?/iu;

const STYLE_WORDS: Record<ServiceStyleWord, string> = {
	buffet: 'Buffet',
	plated: 'Plated, served courses',
	family: 'Family style, sharing dishes',
	canape: 'Canapés, standing',
	lunch: 'Lunch service'
};

const euros = (s: string) => {
	const t = s.replace(/\s/g, '');
	// "1,500" / "1.500" are thousands, "12,50" / "12.50" are cents.
	const n = /^\d{1,3}([.,]\d{3})+$/.test(t)
		? Number(t.replace(/[.,]/g, ''))
		: Number(t.replace(',', '.'));
	return Number.isFinite(n) ? n : null;
};

/** Every requirement the words state, normalised; a count is kept as "vegetarian:6". */
export function dietaryIn(text: string): string[] {
	const out: string[] = [];
	// Request constraints ("lactose-free") keep a head count when the words give one ("4 lactose-free").
	for (const key of constraintsIn(text)) {
		const c = CONSTRAINTS.find((x) => x.key === key)!;
		const forms = c.forms.map((f) => f.replace(/[-\s]/g, '[- ]?')).join('|');
		const counted = text.match(new RegExp(String.raw`(\d{1,4})\s+(?:${forms})(?![\p{L}])`, 'iu'));
		out.push(counted ? `${c.label}:${Number(counted[1])}` : c.label);
	}
	for (const d of DIETS) {
		const counted = text.match(
			new RegExp(String.raw`(\d{1,4})\s+(?:${d.re.source})(?![\p{L}])`, 'iu')
		);
		if (counted) out.push(`${d.label}:${Number(counted[1])}`);
		else if (d.re.test(text)) out.push(d.label);
	}
	return [...new Set(out)];
}

/** The brief as far as the words go. `today` is the simulator's Helsinki date. */
export function draftBrief(text: string, today: string): BriefDraft {
	const from: BriefDraft['from'] = {};
	const notes: string[] = [];
	const guests = guestsIn(text);
	if (guests !== null) from.guests = 'words';

	const d = findDate(text, today);
	let date: string | null = null;
	if (d?.invalid) notes.push(d.invalid);
	else if (d && d.iso < today) notes.push(`"${d.text}" is in the past`);
	else if (d) {
		date = d.iso;
		from.date = 'words';
	}

	const courses = coursesIn(text);
	if (courses !== null) from.courses = 'words';
	const serviceStyle = STYLES.find((s) => s.re.test(text))?.style ?? null;
	if (serviceStyle) from.serviceStyle = 'words';

	const typed = dietaryIn(text);
	if (typed.length) from.dietary = 'words';

	let budgetCents: number | null = null;
	const b = text.match(BUDGET);
	if (b) {
		const v = euros(b[1] ?? b[2]);
		if (v !== null && b[3] && guests !== null) budgetCents = Math.round(v * guests * 100);
		else if (v !== null && !b[3]) budgetCents = Math.round(v * 100);
		else if (v !== null)
			notes.push(`€${v} per guest: the total follows once the guest count is known`);
		if (budgetCents !== null) from.budget = 'words';
	}
	if (/\b\d\s*-?\s*star\b|michelin|fine dining/i.test(text)) notes.push('fine-dining level asked');

	const title = (d && !d.invalid ? text.replace(d.text, ' ') : text)
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[,.;:]+$/, '')
		.slice(0, 200);
	return {
		title: title ? title[0].toUpperCase() + title.slice(1) : 'Event',
		guests,
		date,
		dateText: d && !d.invalid ? d.text : null,
		serviceStyle,
		courses,
		dietary: typed.length ? typed : null,
		budgetCents,
		from,
		notes
	};
}

/** Courses only matter for served menus; a buffet or canapés are sized by dishes, not courses. */
const needsCourses = (s: ServiceStyleWord | null) => s === 'plated' || s === 'family';

/** The fields still missing, in the order they are asked. */
export function missing(d: BriefDraft): BriefField[] {
	const out: BriefField[] = [];
	if (d.guests === null) out.push('guests');
	if (d.date === null) out.push('date');
	if (d.serviceStyle === null) out.push('serviceStyle');
	if (d.courses === null && needsCourses(d.serviceStyle)) out.push('courses');
	if (d.dietary === null) out.push('dietary');
	if (d.budgetCents === null) out.push('budget');
	return out;
}

/** The next question, or null when the brief is complete. */
export function nextQuestion(d: BriefDraft, today: string): BriefQuestion | null {
	const field = missing(d)[0];
	if (!field) return null;
	const id = `brief.${field}` as const;
	const chip = (label: string, value: BriefAnswer['value']) => ({ label, answer: { id, value } });
	switch (field) {
		case 'guests':
			return {
				id,
				field,
				text: 'How many guests?',
				why: 'Every amount on the menu is per guest.',
				chips: [20, 50, 100, 140].map((n) => chip(`${n} guests`, n)),
				input: { kind: 'number', placeholder: 'Guests', unit: 'guests' }
			};
		case 'date': {
			const next = (dow: number) => addDays(today, (dow - weekdayOf(today) + 7) % 7 || 7);
			return {
				id,
				field,
				text: 'On which day is the event?',
				why: 'Delivery is planned for the day before, within the supplier’s cut-offs.',
				chips: [chip(`Friday ${next(5)}`, next(5)), chip(`Saturday ${next(6)}`, next(6))],
				input: { kind: 'date', placeholder: 'YYYY-MM-DD' }
			};
		}
		case 'serviceStyle':
			return {
				id,
				field,
				text: 'How will it be served?',
				why: 'A buffet needs more variety and margin than plated courses.',
				chips: (Object.keys(STYLE_WORDS) as ServiceStyleWord[]).map((s) => chip(STYLE_WORDS[s], s))
			};
		case 'courses':
			return {
				id,
				field,
				text: 'How many courses?',
				why: 'Each course is a dish with its own ingredients.',
				chips: [3, 4, 5, 7].map((n) => chip(`${n} courses`, n)),
				input: { kind: 'number', placeholder: 'Courses', unit: 'courses' }
			};
		case 'dietary':
			return {
				id,
				field,
				text: 'Any dietary requirements?',
				why: 'Requirements are hard limits: every dish and product is checked against them.',
				multi: true,
				chips: [
					chip('None', []),
					...['lactose-free', 'gluten-free', 'vegetarian', 'vegan', 'nut-free'].map((l) =>
						chip(l[0].toUpperCase() + l.slice(1), [l])
					)
				],
				input: { kind: 'text', placeholder: 'e.g. vegetarian:6, no pork' }
			};
		case 'budget': {
			const per = [25, 40, 60];
			return {
				id,
				field,
				text: 'Is there a food budget?',
				why: 'Advisory: the menu aims at it; your mandate’s limits still decide what is ordered.',
				chips: [
					chip('No budget', 0),
					...(d.guests
						? per.map((e) => chip(`€${e} per guest (€${e * d.guests!})`, e * d.guests!))
						: [])
				],
				input: { kind: 'number', placeholder: 'Total, ex VAT', unit: '€' }
			};
		}
	}
}

const STYLES_SET = new Set(Object.keys(STYLE_WORDS));

/** Applies the chef's answers; a malformed one is ignored and the question stays open. */
export function applyBriefAnswers(
	d: BriefDraft,
	answers: BriefAnswer[],
	today: string
): BriefDraft {
	const next: BriefDraft = { ...d, from: { ...d.from }, notes: [...d.notes] };
	const int = (v: unknown, lo: number, hi: number) =>
		typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
	for (const a of answers) {
		const v = a.value;
		switch (a.id) {
			case 'brief.guests': {
				const n = int(v, 1, 2000);
				if (n !== null) [next.guests, next.from.guests] = [n, 'answer'];
				break;
			}
			case 'brief.date':
				if (typeof v === 'string' && realDate(v) && v >= today)
					[next.date, next.dateText, next.from.date] = [v, null, 'answer'];
				break;
			case 'brief.serviceStyle':
				if (typeof v === 'string' && STYLES_SET.has(v))
					[next.serviceStyle, next.from.serviceStyle] = [v as ServiceStyleWord, 'answer'];
				break;
			case 'brief.courses': {
				const n = int(v, 1, 12);
				if (n !== null) [next.courses, next.from.courses] = [n, 'answer'];
				break;
			}
			case 'brief.dietary': {
				const list = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null)
					?.map((s) => String(s).trim().toLowerCase())
					.filter((s) => s && s !== 'none' && s.length <= 60);
				if (!list) break;
				// Typed requirements stay: an answer adds to them, never replaces them.
				next.dietary = [...new Set([...(d.dietary ?? []), ...list])].slice(0, 20);
				next.from.dietary = d.from.dietary ?? 'answer';
				break;
			}
			case 'brief.budget':
				if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000_000)
					[next.budgetCents, next.from.budget] = [Math.round(v * 100), 'answer'];
				break;
		}
	}
	if (!needsCourses(next.serviceStyle) && next.from.courses !== 'words') next.courses = null;
	return next;
}

/** Answers from a request body; anything malformed is dropped, never trusted. */
export function readBriefAnswers(raw: unknown): BriefAnswer[] {
	if (!Array.isArray(raw)) return [];
	const ids = new Set(
		['guests', 'date', 'serviceStyle', 'courses', 'dietary', 'budget'].map((f) => `brief.${f}`)
	);
	const out: BriefAnswer[] = [];
	for (const a of raw.slice(0, 12)) {
		if (!a || typeof a !== 'object') continue;
		const { id, value } = a as Record<string, unknown>;
		if (typeof id !== 'string' || !ids.has(id)) continue;
		const ok =
			typeof value === 'number' ||
			(typeof value === 'string' && value.length <= 200) ||
			(Array.isArray(value) &&
				value.length <= 20 &&
				value.every((x) => typeof x === 'string' && x.length <= 60));
		if (ok) out.push({ id: id as BriefAnswer['id'], value: value as BriefAnswer['value'] });
	}
	return out;
}

/** The complete brief, or null while a question is open. */
export function toEventBrief(d: BriefDraft, text: string): EventBriefT | null {
	if (missing(d).length) return null;
	return EventBrief.parse({
		title: d.title,
		date: d.date,
		guests: d.guests,
		serviceStyle: d.serviceStyle,
		...(d.courses !== null ? { courses: d.courses } : {}),
		dietary: d.dietary ?? [],
		...(d.budgetCents ? { budgetCents: d.budgetCents } : {}),
		...(d.notes.length ? { notes: d.notes.join('; ') } : {}),
		provenance: {
			source: 'parsed',
			ref: text.slice(0, 200),
			note: `from the words: ${
				Object.entries(d.from)
					.filter(([, s]) => s === 'words')
					.map(([k]) => k)
					.join(', ') || 'none'
			}; answered by the chef: ${
				Object.entries(d.from)
					.filter(([, s]) => s === 'answer')
					.map(([k]) => k)
					.join(', ') || 'none'
			}`
		}
	});
}
