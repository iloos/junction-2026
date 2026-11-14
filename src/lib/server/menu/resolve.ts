/**
 * Menu ingredient → catalogue product, made stable across proposals.
 *
 * The model chooses the Finnish words, and the catalogue resolver is strict about the main ingredient, so the same
 * ingredient can resolve under one spelling and not another ("porsaan kylki" resolves, "porsaankylki" doesn't). This
 * tries a short, ordered list of variants: the query, its compound split, the model's alternatives and any trade name
 * in the label's brackets. It prefers a product already pinned for that ingredient in this kitchen. A product
 * reached only through a variant must not be a processed form the ingredient doesn't name ("sipuli" must not
 * become ground onion for "keltasipuli").
 */
import type { Product, ProductId } from '$lib/core/contracts';
import type { Catalog, Resolution } from '$lib/core/ports';

/** At most this many resolver calls per ingredient (each is a local, in-memory search). */
export const MAX_VARIANTS = 5;

/** Finnish genitive animal prefixes that start a cut's compound name ("porsaankylki" = "porsaan kylki"). */
const GENITIVE =
	/^(porsaan|naudan|broilerin|kanan|lampaan|kalkkunan|poron|hirven|vasikan|ankan)(.{3,})$/;
/** Head nouns a compound ends in; splitting before one gives the catalogue's two-word form ("limetti mehu"). */
const HEADS = [
	'täysmehu',
	'mehu',
	'kerma',
	'maito',
	'juusto',
	'fileet',
	'filee',
	'jauho',
	'riisi',
	'kastike',
	'öljy',
	'pyree',
	'murska',
	'tahna',
	'liemi',
	'sipuli',
	'kylki',
	'paisti',
	'levyt',
	'levy'
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** One-word compounds split into the catalogue's two-word forms; [] when nothing splits. */
export function splitCompound(query: string): string[] {
	const q = norm(query);
	if (q.includes(' ')) return [];
	const out: string[] = [];
	const g = GENITIVE.exec(q);
	if (g) out.push(`${g[1]} ${g[2]}`);
	for (const h of HEADS)
		if (q.endsWith(h) && q.length - h.length >= 3) {
			out.push(`${q.slice(0, -h.length)} ${h}`);
			break;
		}
	return out;
}

/** "Porsaan kylkirivi (ribs)" → ["ribs"]: a trade name the chef or model put in brackets. */
function bracketed(label: string): string[] {
	return [...label.matchAll(/\(([^)]{2,40})\)/g)]
		.map((m) => norm(m[1]))
		.filter((s) => !/\d/.test(s));
}

/** The words to try, in order, without repeats: the query first, then the variants. */
export function queryVariants(query: string, alt: string[] = [], label = ''): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of [query, ...splitCompound(query), ...alt, ...bracketed(label)].map(norm))
		if (v && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	return out.slice(0, MAX_VARIANTS);
}

/** Forms that change what the product is; a variant may only pin one that the ingredient itself names. */
const PROCESSED = [
	'jauhettu',
	'kuivattu',
	'savustettu',
	'savu',
	'kypsä',
	'ylikypsä',
	'kassler',
	'jauhe'
];

/** Words naming what form an ingredient comes in; a variant that drops one must still find it in the product. */
const FORM_WORDS =
	/adobo|kastike|kastikkee|sauce|tahna|paste|mehu|juice|öljy|\boil\b|säilyke|liemi|pyree|murska/gi;

const startsWord = (name: string, word: string) =>
	new RegExp(`(^|[^a-zäöå0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(name);

/**
 * A product reached through a variant, not the original words, must be what the variant says: the variant's first
 * word starts a word in the name ("sipuli" is not "Ruohosipuli", chives), any form the original words name is in the
 * name ("chipotle adobo" is not chilli powder), and it is no processed form the original words don't name.
 */
function variantFits(
	p: Pick<Product, 'nameFi' | 'nameEn'> & { baseKey?: { form?: string[] } },
	variant: string,
	named: string
): boolean {
	const name = `${p.nameFi} ${p.nameEn ?? ''}`;
	if (!startsWord(name, variant.split(' ')[0])) return false;
	const forms = [...new Set(named.match(FORM_WORDS) ?? [])];
	if (forms.some((f) => !name.toLowerCase().includes(f.toLowerCase()))) return false;
	return processedForms(p).every((f) => named.includes(f));
}

function processedForms(p: Pick<Product, 'nameFi' | 'nameEn'> & { baseKey?: { form?: string[] } }) {
	const words = `${p.nameFi} ${(p.baseKey?.form ?? []).join(' ')}`.toLowerCase();
	return PROCESSED.filter((f) => new RegExp(`(^|[^a-zäöå])${f}`).test(words));
}

/* ── Pins remembered per kitchen ──────────────────────────────────────────── */

/**
 * The product a kitchen pinned for an ingredient, by workspace + kitchen + normalised ingredient words. In process
 * for now (one container, D3); a reset workspace starts with none.
 */
const pins = new Map<string, ProductId>();
const pinKey = (ws: string, kitchenId: string, ingredient: string) =>
	`${ws}|${kitchenId}|${norm(ingredient)}`;

export function rememberPin(ws: string, kitchenId: string, words: string[], productId: ProductId) {
	for (const w of words) if (w.trim()) pins.set(pinKey(ws, kitchenId, w), productId);
}

export function pinnedFor(ws: string, kitchenId: string, words: string[]): ProductId | undefined {
	for (const w of words) {
		const p = pins.get(pinKey(ws, kitchenId, w));
		if (p) return p;
	}
	return undefined;
}

/** Tests only. */
export function clearPins() {
	pins.clear();
}

/* ── Resolution ───────────────────────────────────────────────────────────── */

export interface Resolved {
	resolution: Resolution;
	/** The words that resolved, when not the original query. */
	via?: string;
	/** Set when a remembered pin or a brief hint answered, not the resolver. */
	pinned?: 'remembered' | 'hint';
}

/**
 * Resolves an ingredient through its variants with `resolveOne` (the diet-aware single-query resolver). The first
 * variant that resolves wins; a variant's candidates must not be a processed form the original words don't name. If
 * none resolves, the original query's unresolved answer is returned, so the reason stays about the chef's words.
 */
export async function resolveVariants(
	catalog: Pick<Catalog, 'get'>,
	resolveOne: (q: string) => Promise<Resolution | null>,
	o: {
		query: string;
		alt?: string[];
		label?: string;
		pinned?: ProductId;
		pinSource?: 'remembered' | 'hint';
	}
): Promise<Resolved | null> {
	if (o.pinned) {
		const p = (await catalog.get([o.pinned])).get(o.pinned);
		if (p)
			return {
				resolution: {
					status: 'resolved',
					query: o.query,
					candidates: [{ productId: o.pinned, score: 1 }]
				},
				pinned: o.pinSource ?? 'remembered'
			};
	}
	const variants = queryVariants(o.query, o.alt, o.label);
	const named = norm(`${o.query} ${o.label ?? ''}`);
	let first: Resolution | null = null;
	for (const [i, v] of variants.entries()) {
		const r = await resolveOne(v);
		if (i === 0) first = r;
		if (r?.status !== 'resolved' || !r.candidates.length) continue;
		if (i === 0) return { resolution: r };
		const got = await catalog.get(r.candidates.map((c) => c.productId));
		const ok = r.candidates.filter((c) => {
			const p = got.get(c.productId);
			return p !== undefined && variantFits(p, v, named);
		});
		if (ok.length) return { resolution: { ...r, query: o.query, candidates: ok }, via: v };
	}
	return first ? { resolution: first } : null;
}
