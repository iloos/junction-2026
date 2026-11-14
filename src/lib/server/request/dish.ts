/**
 * Dish requests: "10000 bolognese pasta, half only cow and the other half half" is 10,000 portions of a dish, not
 * 10,000 packs of a product. This module reads the dish and the count, turns a meat ratio in words into explicit
 * shares, and prices two ways to serve it side by side: ready-made (a prepared sauce plus pasta) and from raw
 * ingredients (pasta, beef mince, mixed mince, tomato, onion…), each through the same tool gate as the request flow.
 *
 * One entry point for the page and the chat agent: `interpretDish(text, deps)`. Pure parts (`readDish`,
 * `readMeatShares`) are exported for tests and callers that only need the reading.
 */
import type { Offer, Product } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { num } from '$lib/ui/format';
import { convert, type Conversion } from './convert';
import { withLot, unpickable } from './lookup';
import { animalsIn, clashWith, plantBased, type Animal } from './checks';
import type { ParsedItem } from './parse';
import type { RequestAnswer } from './workspace';
import { serveTool } from '$lib/server/tools/serve';

/* ── Reading ──────────────────────────────────────────────────────────────── */

/** One kind of mince the request can be bought as. */
export type MinceKind = 'beef' | 'pork' | 'mixed';

export interface MeatShares {
	/** What to buy: shares of the mince by kind, summing to 1. */
	parts: { kind: MinceKind; share: number }[];
	/** What the mince is by animal, assuming mixed mince is half beef, half pork. */
	animal: { beef: number; pork: number };
	/** The words it came from. */
	from: string;
	/** "Mince: 75% beef, 25% pork, from 'half only cow, the other half half'". */
	line: string;
}

const BEEF = String.raw`(?:only\s+|pure\s+|just\s+)?(?:cow|beef|nauta|naudan|naudanliha|härkä)(?:\s+mince)?`;
const PORK = String.raw`(?:only\s+|pure\s+|just\s+)?(?:pork|pig|sika|sian|possu|porsas)(?:\s+mince)?`;
const MIXED = String.raw`(?:half(?:\s+and\s+half|[\s-]+half)?|mixed|mix|beef[\s-/]+pork(?:\s+mix)?|pork[\s-/]+beef|nauta[\s-/]+sika|sika[\s-/]+nauta|jauheliha\s+na\/si)(?:\s+mince)?(?:\s+mix)?`;
const KIND = String.raw`(${MIXED}|${BEEF}|${PORK})`;
/** "half X … (the) other half Y", "half X and half Y", "50% X, 50% Y". */
const HALVES = new RegExp(
	String.raw`\b(?:half|50\s*%)\s+(?:of\s+it\s+|the\s+mince\s+)?(?:is\s+|as\s+)?${KIND}\b[^.;]*?\b(?:(?:the\s+)?other\s+half|half|50\s*%|the\s+rest)\s+(?:is\s+|as\s+)?${KIND}`,
	'i'
);

function kindOf(words: string): MinceKind {
	const w = words.toLowerCase();
	if (new RegExp(`^${MIXED}$`, 'i').test(w.trim())) return 'mixed';
	if (new RegExp(`^${PORK}$`, 'i').test(w.trim())) return 'pork';
	return 'beef';
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "half only cow and the other half half" → 50% beef mince + 50% mixed mince = 75% beef, 25% pork. */
export function readMeatShares(text: string): MeatShares | null {
	const m = text.match(HALVES);
	if (!m) return null;
	const a = kindOf(m[1]);
	const b = kindOf(m[2]);
	const parts =
		a === b
			? [{ kind: a, share: 1 }]
			: [
					{ kind: a, share: 0.5 },
					{ kind: b, share: 0.5 }
				];
	const beefOf = (k: MinceKind) => (k === 'beef' ? 1 : k === 'mixed' ? 0.5 : 0);
	const beef = parts.reduce((s, p) => s + p.share * beefOf(p.kind), 0);
	const from = m[0].trim().replace(/\s+/g, ' ');
	return {
		parts,
		animal: { beef, pork: 1 - beef },
		from,
		line: `Mince: ${pct(beef)} beef${beef < 1 ? `, ${pct(1 - beef)} pork` : ''}, from “${from}”${parts.some((p) => p.kind === 'mixed') ? ' (mixed mince read as half beef, half pork)' : ''}`
	};
}

export interface DishRecipeLine {
	key: string;
	label: string;
	/** Grams per portion, as bought (dry pasta, raw mince). */
	gramsPerPortion: number;
	/** Finnish catalogue searches, most specific first. */
	search: string[];
	/** Valio categories the product must be in. */
	categories?: string[];
	/** Name must contain one of these. */
	nameHas?: RegExp;
	/** Name must not contain these. */
	nameNot?: RegExp;
	/** This line is the mince the ratio splits. */
	mince?: true;
}

export interface DishDef {
	key: string;
	name: string;
	/** Matches the dish in the request words, typos included ("bolongese"). */
	words: RegExp;
	/** A word that names a product, not a dish ("sauce"): the request is then a product order. */
	productWords: RegExp;
	ready: { lines: DishRecipeLine[]; labour: string };
	raw: { lines: DishRecipeLine[]; labour: string; source: string };
	meat: boolean;
}

const PASTA: DishRecipeLine = {
	key: 'pasta',
	label: 'Spaghetti, dry',
	gramsPerPortion: 90,
	search: ['spagetti', 'spagetti pasta'],
	categories: ['21380'],
	nameHas: /spagetti/i,
	nameNot: /gluteeniton|täysjyvä|kurpitsa|bolognese|lihavuoka/i
};
const MINCE: Record<MinceKind, DishRecipeLine> = {
	beef: {
		key: 'mince-beef',
		label: 'Beef mince',
		gramsPerPortion: 110,
		search: ['naudan jauheliha', 'nauta jauheliha', 'jauheliha'],
		categories: ['18760', '18720', '41702'],
		nameHas: /jauheliha/i,
		nameNot: /pihvi|lasagne|kypsä|ruskistettu|paahdettu|burgeri|mauste/i,
		mince: true
	},
	pork: {
		key: 'mince-pork',
		label: 'Pork mince',
		gramsPerPortion: 110,
		search: ['porsaan jauheliha', 'sian jauheliha', 'jauheliha'],
		categories: ['18760', '18720', '41702'],
		nameHas: /jauheliha/i,
		nameNot: /pihvi|lasagne|kypsä|ruskistettu|paahdettu|burgeri|mauste/i,
		mince: true
	},
	mixed: {
		key: 'mince-mixed',
		label: 'Mixed beef and pork mince',
		gramsPerPortion: 110,
		search: ['nauta-sika jauheliha', 'jauheliha na/si', 'possu-nauta jauheliha', 'jauheliha'],
		categories: ['18760', '18720', '41702'],
		nameHas: /jauheliha/i,
		nameNot: /pihvi|lasagne|kypsä|ruskistettu|paahdettu|burgeri|mauste/i,
		mince: true
	}
};

export const DISHES: DishDef[] = [
	{
		key: 'bolognese',
		name: 'pasta bolognese',
		// "bolognese", "bolognaise", "bolongese", "bolgnese", "spaghetti bolognese", "spagetti bolognese".
		words: /\b(?:spag+h?et+i\s+|pasta\s+)?bol[a-z]{3,8}(?:ese|aise)(?:\s+pasta)?\b/i,
		productWords: /\b(sauce|kastike|bolognesekastike|jar|pouch|bag)\b/i,
		meat: true,
		ready: {
			labour: 'Heat the sauce, boil the pasta on the day',
			lines: [
				{
					key: 'sauce',
					label: 'Bolognese sauce, ready-made',
					gramsPerPortion: 200,
					search: ['bolognesekastike', 'bolognese', 'jauhelihakastike'],
					categories: ['17300', '21920', '21904', '41754'],
					nameHas: /bolognese|jauhelihakastike/i,
					nameNot: /spagetti|lastenateria|piltti|via pasta/i
				},
				PASTA
			]
		},
		raw: {
			labour: 'Cook in house: brown the mince, simmer the sauce 1–2 h, boil the pasta',
			source:
				'team recipe: 90 g dry pasta, 110 g mince, 100 g crushed tomato, 30 g onion, 20 g carrot per portion',
			lines: [
				PASTA,
				MINCE.beef,
				{
					key: 'tomato',
					label: 'Crushed tomato',
					gramsPerPortion: 100,
					search: ['tomaattimurska', 'murskattu tomaatti'],
					categories: ['21590'],
					nameHas: /tomaattimurska|murskattu tomaatti/i,
					nameNot: /luomu/i
				},
				{
					key: 'onion',
					label: 'Onion',
					gramsPerPortion: 30,
					search: ['sipuli 10kg', 'sipuli'],
					categories: ['17405', '17432'],
					nameHas: /^sipuli|keltasipuli/i,
					nameNot: /puna|valko|kevät|shalotti|paisti|nippu|makea/i
				},
				{
					key: 'carrot',
					label: 'Carrot',
					gramsPerPortion: 20,
					search: ['porkkana'],
					nameHas: /^porkkana/i,
					nameNot: /raaste|kuutio|peruna|mehu|sose|riisi|pikkuporkkana|luomu/i
				}
			]
		}
	}
];

export interface DishRead {
	dish: DishDef;
	/** Portions to serve. */
	portions: number;
	/** The words that named the dish and the count. */
	text: string;
	/** True when the count was read as portions without the words saying so (no unit, a large count). */
	assumed: boolean;
	/** Set when the count could also be packs: ask "N portions of pasta bolognese?" first. */
	ask: { question: string; yes: string; no: string } | null;
	mince: MeatShares | null;
}

const PORTIONS =
	/\b(portions?|servings?|annosta|annokselle|annokset|covers|pax|people|persons|guests|hengelle)\b/i;
const NUMBER = /(\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?)(\s*k\b)?/;

/**
 * The dish a request names with a count: no unit (or "portions") → portions. A word that names a product ("sauce")
 * or a physical unit ("kg") makes it a product order instead (null). A small count with no unit is asked.
 */
export function readDish(text: string): DishRead | null {
	for (const dish of DISHES) {
		const m = text.match(dish.words);
		if (!m) continue;
		if (dish.productWords.test(text)) return null;
		const n = text.match(NUMBER);
		if (!n) return null;
		let portions = Number(n[1].replace(/[ ,]/g, '').replace(',', '.'));
		if (n[2]) portions *= 1000;
		if (!Number.isFinite(portions) || portions <= 0) return null;
		// A physical unit right after the number ("20 kg bolognese") is a product amount.
		const after = text.slice((n.index ?? 0) + n[0].length).trimStart();
		if (/^(kg|kilo|g\b|l\b|litre|liter|dl|cases?|packs?|pcs|ltk|ki\b)/i.test(after)) return null;
		const said = PORTIONS.test(text);
		const assumed = !said;
		const ask =
			!said && portions < 50
				? {
						question: `${num(portions)} portions of ${dish.name}?`,
						yes: `Yes, ${num(portions)} portions`,
						no: `No, ${num(portions)} packs`
					}
				: null;
		const from = Math.min(n.index ?? 0, m.index ?? 0);
		const to = Math.max((n.index ?? 0) + n[0].length, (m.index ?? 0) + m[0].length);
		return {
			dish,
			portions,
			text: text.slice(from, to).trim(),
			assumed,
			ask,
			mince: dish.meat ? readMeatShares(text) : null
		};
	}
	return null;
}

/* ── Pricing the two ways ─────────────────────────────────────────────────── */

export interface DishLine {
	key: string;
	label: string;
	/** Total physical amount to buy, kg. */
	kg: number;
	gramsPerPortion: number;
	/** The product picked, or null with `missing`. */
	product: { productId: string; name: string; salesUnit: string } | null;
	search: string;
	salesQty: number | null;
	unitCents: number | null;
	lineCents: number | null;
	/** Stock as Valio states it: "in stock", "Valio doesn't state stock", "out of stock". */
	stock: string | null;
	/** Why nothing was picked. */
	missing?: string;
	/** Products turned down for this line, with the reason (soy for "cow"). */
	filtered: { name: string; reason: string }[];
	/** Valio's own logistic model of the pick (Stock or Terminal). */
	logisticModel: string | null;
}

export interface DishOption {
	kind: 'ready' | 'raw';
	title: string;
	lines: DishLine[];
	/** Sum of the priced lines; `complete` says whether every line is in it. */
	totalCents: number | null;
	perPortionCents: number | null;
	complete: boolean;
	lineCount: number;
	labour: string;
	/** "2 of 5 lines: Valio doesn't state stock". */
	certainty: string;
	/** Meets the meat ratio and the words; `no`/`unknown` say why. */
	meets: { state: 'yes' | 'no' | 'unknown'; why: string };
	source: string;
}

export interface DishInterpretation {
	dish: { key: string; name: string };
	portions: number;
	/** How the words were read, one line each, in the order shown. */
	reasoning: string[];
	mince: MeatShares | null;
	ask: DishRead['ask'];
	options: DishOption[];
	/** The option the kitchen's rules prefer, and why in words. */
	preferred: { kind: 'ready' | 'raw'; why: string };
}

export interface DishDeps {
	handlers: ToolHandlers;
	ctx: CallContext;
	deliverBy: string;
	kitchen?: { weights?: Partial<Record<string, number>>; mandate?: { words?: string } };
	now?: Date;
}

async function tool<T>(d: DishDeps, name: string, input: unknown): Promise<T> {
	const r = await serveTool(name as never, d.ctx, input, d.handlers);
	if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
	return r.value as T;
}

interface Found {
	line: DishRecipeLine;
	share: number;
	label: string;
	animals: Animal[];
	kept: Product[];
	filtered: { name: string; reason: string }[];
	/** The search that found each product: the request flow searches it again to look the pick up. */
	foundBy: Map<string, string>;
}

/** Search one recipe line, keep the products that fit it and the request, and say why the rest went. */
async function findLine(
	d: DishDeps,
	line: DishRecipeLine,
	animals: Animal[],
	share = 1,
	label = line.label
): Promise<Found> {
	const seen = new Map<string, Product>();
	const foundBy = new Map<string, string>();
	for (const q of line.search) {
		const r = await tool<{ products: Product[] }>(d, 'search_products', { query: q, limit: 50 });
		for (const p of r.products)
			if (!seen.has(p.productId)) {
				seen.set(p.productId, p);
				foundBy.set(p.productId, q);
			}
		const fits = [...seen.values()].filter((p) => fitsLine(p, line, animals) === null);
		if (fits.length >= 3) break;
	}
	const kept: Product[] = [];
	const filtered: { name: string; reason: string }[] = [];
	for (const p of seen.values()) {
		const why = fitsLine(p, line, animals);
		if (why === null) kept.push(p);
		else if (why !== 'off-topic') filtered.push({ name: p.nameFi, reason: why });
	}
	return { line, share, label, animals, kept, filtered, foundBy };
}

/** Null when the product fits; 'off-topic' for unrelated hits (not worth listing); else the reason. */
function fitsLine(p: Product, line: DishRecipeLine, animals: Animal[]): string | null {
	if (line.nameHas && !line.nameHas.test(p.nameFi)) return 'off-topic';
	if (line.categories && !line.categories.includes(p.category)) return 'off-topic';
	if (line.mince || line.key === 'sauce') {
		const clash = clashWith(p, { animals, meat: true });
		if (clash) return clash;
	}
	if (line.mince) {
		const has = animalsIn(p);
		const want = new Set(animals);
		if (has.length && (has.length !== want.size || has.some((a) => !want.has(a))))
			return `${has.join(' and ')} mince, the ${line.label.toLowerCase()} asked for ${[...want].join(' and ')}`;
		if (!has.length) return 'the name does not say which meat';
	}
	if (line.nameNot?.test(p.nameFi)) return 'off-topic';
	return null;
}

/** "3 no price from Valio; 1 only 40 ST available": each reason once, with how many. */
function reasonsOf(rs: string[]): string {
	const n = new Map<string, number>();
	for (const r of rs) n.set(r, (n.get(r) ?? 0) + 1);
	return [...n].map(([r, k]) => (rs.length > 1 ? `${k} ${r}` : r)).join('; ');
}

/** Each picked line: the cheapest deliverable product per kg, sized in its sales unit. */
function priceLine(
	f: Found,
	kg: number,
	offers: Map<string, Offer>,
	now: Date | undefined
): DishLine {
	type C = { p: Product; c: Conversion; o: Offer | undefined; cents: number | null };
	const cs: C[] = f.kept.map((p) => {
		const c = withLot(convert(kg, 'kg', p), p);
		const o = offers.get(p.productId);
		const cents = c.ok && o?.price ? o.price.unitCents * c.salesQty : null;
		return { p, c, o, cents };
	});
	const ok = cs
		.filter((x) => x.c.ok && !unpickable(x.o, x.c, now))
		.sort((a, b) => (a.cents ?? Infinity) - (b.cents ?? Infinity));
	const base = {
		key: f.line.key,
		label: f.label,
		kg: +kg.toFixed(3),
		gramsPerPortion: f.line.gramsPerPortion * f.share,
		search: f.line.search[0],
		filtered: f.filtered.slice(0, 4)
	};
	const best = ok[0];
	if (!best) {
		const why = cs.length
			? reasonsOf(cs.map((x) => unpickable(x.o, x.c, now) ?? 'not deliverable'))
			: f.filtered.length
				? `every match was turned down (${f.filtered[0].reason})`
				: 'nothing in the catalogue matched';
		return {
			...base,
			product: null,
			salesQty: null,
			unitCents: null,
			lineCents: null,
			stock: null,
			missing: why,
			logisticModel: null
		};
	}
	const a = best.o!.availability;
	return {
		...base,
		search: f.foundBy.get(best.p.productId) ?? base.search,
		product: { productId: best.p.productId, name: best.p.nameFi, salesUnit: best.p.salesUnit },
		salesQty: (best.c as { salesQty: number }).salesQty,
		unitCents: best.o!.price!.unitCents,
		lineCents: best.cents,
		stock:
			a.kind === 'known'
				? a.amount === null
					? "Valio doesn't state stock"
					: 'in stock'
				: a.kind === 'unknown'
					? "Valio doesn't state stock"
					: a.kind,
		logisticModel: a.logisticModel
	};
}

function option(
	kind: 'ready' | 'raw',
	title: string,
	lines: DishLine[],
	portions: number,
	labour: string,
	source: string,
	meets: DishOption['meets']
): DishOption {
	const priced = lines.filter((l) => l.lineCents !== null);
	const total = priced.length ? priced.reduce((s, l) => s + (l.lineCents ?? 0), 0) : null;
	const unknown = lines.filter((l) => l.stock === "Valio doesn't state stock").length;
	const missing = lines.filter((l) => !l.product).length;
	return {
		kind,
		title,
		lines,
		totalCents: total,
		perPortionCents: total === null ? null : Math.round(total / portions),
		complete: priced.length === lines.length,
		lineCount: lines.length,
		labour,
		certainty: missing
			? `${missing} of ${lines.length} lines have no product`
			: unknown
				? `${unknown} of ${lines.length} lines: Valio doesn't state stock`
				: 'every line in stock at Valio',
		meets,
		source
	};
}

/**
 * Reads a dish request and prices both ways to serve it. Null when the words are not a dish with a count. Searches
 * and one quote go through the tool gate as `ctx`; nothing is ordered.
 */
export async function interpretDish(text: string, d: DishDeps): Promise<DishInterpretation | null> {
	const read = readDish(text);
	if (!read) return null;
	const { dish, portions, mince } = read;
	const shares = mince?.parts ?? (dish.meat ? [{ kind: 'beef' as MinceKind, share: 1 }] : []);
	const animalsOf = (k: MinceKind): Animal[] =>
		k === 'beef' ? ['beef'] : k === 'pork' ? ['pork'] : ['beef', 'pork'];
	const asked: Animal[] = mince ? [...new Set(shares.flatMap((s) => animalsOf(s.kind)))] : [];

	// From raw: the recipe with the mince split by the ratio.
	const rawFound: Found[] = [];
	for (const l of dish.raw.lines) {
		if (!l.mince) rawFound.push(await findLine(d, l, []));
		else
			for (const s of shares) {
				const ml = MINCE[s.kind];
				rawFound.push(
					await findLine(
						d,
						{ ...ml, gramsPerPortion: l.gramsPerPortion },
						animalsOf(s.kind),
						s.share,
						`${ml.label} (${pct(s.share)} of the mince)`
					)
				);
			}
	}
	const readyFound: Found[] = [];
	for (const l of dish.ready.lines)
		readyFound.push(await findLine(d, l, l.key === 'sauce' ? asked : []));

	// One quote for the few cheapest-looking candidates of every line.
	const want = new Set<string>();
	for (const f of [...rawFound, ...readyFound])
		for (const p of f.kept.slice(0, 30)) want.add(p.productId);
	const offers = new Map<string, Offer>();
	if (want.size) {
		const q = await tool<{ offers: Offer[] }>(d, 'quote', {
			productIds: [...want].slice(0, 200),
			deliverBy: d.deliverBy
		});
		for (const o of q.offers) offers.set(o.productId, o);
	}
	const kgOf = (f: Found) => (portions * f.line.gramsPerPortion * f.share) / 1000;
	// Cut-offs are the date control's job: an option is priced as it would be on an open day, never dropped for one.
	const rawLines = rawFound.map((f) => priceLine(f, kgOf(f), offers, undefined));
	const readyLines = readyFound.map((f) => priceLine(f, kgOf(f), offers, undefined));

	const minceOk = rawLines.filter((l) => l.key.startsWith('mince')).every((l) => l.product);
	const sauce = readyLines.find((l) => l.key === 'sauce');
	const sauceAnimals = sauce?.product ? animalsIn({ nameFi: sauce.product.name }) : [];
	const ratioWords = mince ? `${pct(mince.animal.beef)} beef` : 'meat';
	const readyMeets: DishOption['meets'] = !sauce?.product
		? { state: 'no', why: `no ready-made sauce fits: ${sauce?.missing ?? 'none found'}` }
		: mince
			? {
					state: 'unknown',
					why: `the sauce ${sauceAnimals.length ? `says ${sauceAnimals.join(' and ')}` : "doesn't say which meat"}, not its share: ${ratioWords} can't be checked`
				}
			: plantBased({ nameFi: sauce.product.name, diet: [] })
				? { state: 'no', why: 'plant-based sauce' }
				: { state: 'yes', why: 'meat sauce' };
	const rawMeets: DishOption['meets'] = minceOk
		? {
				state: 'yes',
				why: mince ? `bought to the ratio: ${mince.line.replace(/^Mince: /, '')}` : 'beef mince'
			}
		: { state: 'no', why: 'a mince line has no product' };

	const options = [
		option(
			'raw',
			'Cook from raw ingredients',
			rawLines,
			portions,
			dish.raw.labour,
			dish.raw.source,
			rawMeets
		),
		option(
			'ready',
			'Buy it ready-made',
			readyLines,
			portions,
			dish.ready.labour,
			'Valio catalogue: prepared sauce, 200 g per portion, plus dry pasta',
			readyMeets
		)
	];

	// The kitchen's rule: an option that meets the words beats one that can't be shown to; then price if the kitchen
	// weighs it, else from raw (the request names the meat itself).
	const [raw, ready] = options;
	const priceFirst =
		(d.kitchen?.weights?.price ?? 0) >=
		Math.max(0, ...Object.values(d.kitchen?.weights ?? {}).map((x) => x ?? 0));
	let preferred: DishInterpretation['preferred'];
	if (raw.meets.state === 'yes' && ready.meets.state !== 'yes')
		preferred = {
			kind: 'raw',
			why: `only cooking from raw meets the request (${ready.meets.why})`
		};
	else if (ready.meets.state === 'yes' && raw.meets.state !== 'yes')
		preferred = { kind: 'ready', why: `only the ready-made option has every line` };
	else if (
		priceFirst &&
		raw.perPortionCents !== null &&
		ready.perPortionCents !== null &&
		ready.perPortionCents < raw.perPortionCents
	)
		preferred = {
			kind: 'ready',
			why: 'your mandate weighs price first, and it is cheaper per portion'
		};
	else preferred = { kind: 'raw', why: 'it follows the request word for word' };

	const reasoning = [
		`${num(portions)} portions of ${dish.name}, from “${read.text}”${read.assumed ? ' (no unit given: read as portions)' : ''}`,
		...(mince ? [mince.line] : []),
		...rawLines
			.filter((l) => l.key.startsWith('mince'))
			.map(
				(l) =>
					`${l.label}: ${num(l.kg, 1)} kg (${num(l.gramsPerPortion, 1)} g × ${num(portions)} portions)`
			)
	];
	return {
		dish: { key: dish.key, name: dish.name },
		portions,
		reasoning,
		mince,
		ask: read.ask,
		options,
		preferred
	};
}

/**
 * The chosen option as request items, each pinned to its product: the request flow then looks up, sizes and orders
 * them like any typed item (cut-offs, mandate, approval). Lines without a product are left out and named.
 */
export function dishItems(
	interp: DishInterpretation,
	kind: 'ready' | 'raw'
): { items: ParsedItem[]; answers: RequestAnswer[]; left: string[] } {
	const o = interp.options.find((x) => x.kind === kind)!;
	const items: ParsedItem[] = [];
	const answers: RequestAnswer[] = [];
	const left: string[] = [];
	for (const l of o.lines) {
		if (!l.product) {
			left.push(`${l.label}: ${l.missing}`);
			continue;
		}
		const id = `dish.${interp.dish.key}.${l.key}`;
		items.push({
			id,
			text: `${num(l.kg, 3)} kg ${l.label.toLowerCase()}`,
			query: l.label.toLowerCase(),
			product: null,
			search: [l.search],
			qty: l.kg,
			unit: 'kg',
			constraints: [],
			variant: null,
			ambiguities: []
		});
		answers.push({
			item: id,
			productId: l.product.productId,
			why: `the dish's ${kind === 'raw' ? 'from-raw' : 'ready-made'} pick, the cheapest that fits`
		});
	}
	return { items, answers, left };
}
