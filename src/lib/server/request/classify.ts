/**
 * Is this a purchase of named products, or an event to plan? An open brief ("Christmas dinner for 50
 * on 20 December", "5-star 5-course dinner for 50") names no product to search, so the catalogue must
 * never see it as a query. Deterministic and cheap: it runs before lookup, on both parser paths.
 */
import type { ParsedItem } from './parse';

export interface EventBrief {
	/** Guests from "for 50", "50 guests", "50 hengelle". */
	guests: number | null;
	/** Courses from "5-course" / "5 ruokalajia". */
	courses: number | null;
	/** The words that made this an event ("christmas dinner"). */
	occasion: string;
	/** Set when the request matches the seeded event this kitchen already plans. */
	seeded: { eventId: string; title: string } | null;
}

const OCCASION =
	/(?<![\p{L}])(christmas|xmas|dinner|lunch|brunch|buffet|banquet|party|wedding|gala|reception|celebration|catering|event|menu|courses?|illallinen|illallisen|lounas|juhla\p{L}*|joulu\p{L}*|pikkujoulu\p{L}*|ruokalista|menyy|tarjoilu)(?![\p{L}])/giu;
const GUESTS = [
	/(?<![\p{L}\d-])for\s+(\d{1,5})(?:\s+(?:people|guests|persons|pax|covers|diners))?(?![\p{L}\d-])/iu,
	/(?<![\p{L}\d-])(\d{1,5})\s+(?:people|guests|persons|pax|diners|hengelle|henkeä|hengen|vierasta|vieraalle)(?![\p{L}])/iu
];
const COURSES = /(\d{1,2})[\s-]*(?:course|courses|ruokalajia|ruokalajin)(?![\p{L}])/iu;

/** Units that make an item a real purchase line ("20 kg salmon"), not a brief. */
const PHYSICAL = new Set(['l', 'kg', 'pcs', 'case']);

/** The seeded event a kitchen already plans, matched by its words (title words, kitchen). */
const SEEDED = [
	{
		eventId: 'event-xmas-140',
		kitchenId: 'k-hotel',
		title: 'Christmas buffet for 140',
		words: /(?<![\p{L}])(christmas|xmas|joulu\p{L}*|pikkujoulu\p{L}*)(?![\p{L}])/iu
	}
];

/**
 * An event brief when the request is one, else null. An event needs occasion words and no item
 * that names a known product or a physical amount: "20 kg salmon for the Christmas dinner" and
 * "milk for the lunch menu" are still purchases.
 */
export function classifyRequest(
	text: string,
	items: Pick<ParsedItem, 'product' | 'unit' | 'qty'>[],
	kitchenId: string
): EventBrief | null {
	const occasion = [...text.matchAll(OCCASION)].map((m) => m[1].toLowerCase());
	if (!occasion.length) return null;
	const purchase = items.some(
		(i) => i.product !== null || (i.qty !== null && i.unit !== null && PHYSICAL.has(i.unit))
	);
	if (purchase) return null;
	const g = GUESTS.map((re) => text.match(re)).find(Boolean);
	const c = text.match(COURSES);
	const s = SEEDED.find((e) => e.kitchenId === kitchenId && e.words.test(text));
	return {
		guests: g ? Number(g[1]) : null,
		courses: c ? Number(c[1]) : null,
		occasion: [...new Set(occasion)].join(' '),
		seeded: s ? { eventId: s.eventId, title: s.title } : null
	};
}
