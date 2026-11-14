/**
 * Questions the chef asks the agent that need no plan: what the mandate allows, and what is true about one catalogue
 * product (a recall, its origin, its allergens, other facts). Read deterministically before any model call, answered
 * with read-scope tools only through the one gate (`serveTool`), so an answer can never order, plan or approve.
 *
 * Catalogue facts come first; the web (lookup_facts, the recall watch) adds sourced evidence and never overrides them.
 */
import type { Product, ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { ALLERGEN_NAMES, meets } from '$lib/core/mandate/meets';
import { PRODUCTS } from '$lib/server/request/lexicon';
import { serveTool, type Served } from '$lib/server/tools/serve';
import { isAuthorityImperative, isQuestion } from '../classify';

export type ProductAspect = 'recall' | 'origin' | 'allergens' | 'facts';

export type Question =
	| { kind: 'mandate' }
	| {
			kind: 'product';
			aspect: ProductAspect;
			query: string;
			/** The product the chef picked from "Which one?": answer for exactly this one. */
			productId?: string;
			/** The allergen asked about ("contain gluten?"): a key of ASKED_ALLERGENS. */
			allergen?: string;
	  };

export interface AnswerStep {
	tool: ToolName;
	ok: boolean;
	/** What the step found, in the chef's words. */
	summary: string;
	/**
	 * Where it came from: the static catalogue and our rules (`rules`), a web call just now (`live`), an earlier
	 * live answer or the stored recall watch (`cache`), a recorded real response in fixture mode (`replay`).
	 */
	source: 'rules' | 'live' | 'cache' | 'replay';
}

/** The web tools' own label at the start of their summary ("[cache] 2 web fact(s) ..."). */
const webSource = (r: Served): AnswerStep['source'] => {
	const m = r.ok ? /^\[(live|cache|replay)\]/.exec(r.value.meta?.summary ?? '') : null;
	return (m?.[1] as AnswerStep['source'] | undefined) ?? 'live';
};

export interface Source {
	url: string;
	title?: string;
	/** The site, named in the answer ("ruokavirasto.fi"). */
	host?: string;
}

export const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return undefined;
	}
};

const source = (url: string, title?: string): Source => ({
	url,
	...(title ? { title } : {}),
	...(hostOf(url) ? { host: hostOf(url) } : {})
});

const shortDay = (iso: string) => {
	const d = new Date(iso);
	return Number.isFinite(d.getTime())
		? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Helsinki' })
		: '';
};

export interface Answer {
	steps: AnswerStep[];
	/** The answer in our words; facts from the web are labelled as such. */
	text: string;
	/** Where the web part of the answer came from. Empty when the catalogue answered alone. */
	sources: Source[];
	/** More than one product matched: the chef picks one before anything is answered. */
	choices?: { label: string; value: string }[];
}

/**
 * A "Which one?" button's value: the aspect asked, the product picked and its catalogue name to find it by
 * ("origin:464201:Arla täysmaito 1 l"); search finds products by name, not by id.
 */
export const choiceValue = (aspect: ProductAspect, p: Product) =>
	`${aspect}:${p.productId}:${p.nameFi.slice(0, 120)}`;
export function readChoice(
	value: string
): { aspect: ProductAspect; productId: string; name: string } | null {
	const m = /^(recall|origin|allergens|facts):([\w-]{1,40}):(.{1,120})$/s.exec(value);
	return m ? { aspect: m[1] as ProductAspect, productId: m[2], name: m[3] } : null;
}

/** The only tools an answer may call: all read scope. Checked before every call. */
const ANSWER_TOOLS: ReadonlySet<ToolName> = new Set([
	'get_context',
	'search_products',
	'check_recall',
	'lookup_facts'
]);

const ASKING =
	/^(what|what's|whats|which|show|tell|explain|is|are|does|do|has|have|can|mikä|mitä|näytä|kerro|onko|saako|voiko)\b/i;

const MANDATE_WORDS =
	/\b(mandate|mandates|cap|caps|limit|limits|spending limit|budget limit|order alone|on (its|your|my) own|without (asking|me|approval)|never delegate\w*|valtuu\w*|katto\w*|raja\w*)\b/i;

const ASPECTS: [ProductAspect, RegExp][] = [
	['recall', /\b(recall|recalls|recalled|withdrawn|takaisinve\w*|takaisinkutsu\w*)\b/i],
	[
		'origin',
		/\b(origin|where (is|are|does|do) .+ (from|made|produced)|made in|produced in|country|finnish|domestic|swedish|imported|alkuperä\w*|mistä|kotimai\w*|suomalai\w*)\b/i
	],
	[
		'allergens',
		/\b(allergen\w*|gluten|lactose|milk protein|nuts?|contain|contains|may contain|allergeen\w*|sisältää|gluteeni\w*|laktoosi\w*)\b/i
	],
	['facts', /\b(facts?|tell me about|what is in|ingredients?|nutrition|ainesosa\w*|tietoja)\b/i]
];

/** Words that are about the question, not the product; stripped to leave the product's name. */
const NOT_PRODUCT =
	/\b(is|are|was|the|a|an|our|my|this|that|any|there|does|do|has|have|it|its|of|in|on|for|from|with|me|about|tell|what|whats|what's|which|where|show|explain|please|can|you|check|still|ok|okay|safe|use|made|produced|country|origin|finnish|domestic|swedish|imported|kotimai\w*|suomalai\w*|recall|recalls|recalled|withdrawn|allergen\w*|contain|contains|may|facts?|ingredients?|nutrition|onko|mikä|mitä|mistä|kerro|näytä|takaisinve\w*|takaisinkutsu\w*|alkuperä\w*|sisältää|tietoja|ainesosa\w*)\b/gi;

/**
 * Allergens a chef asks about, by word (English and Finnish): the free-from code meets() reads (lactose, milk, gluten),
 * else the allergen record's codes. Order matters: "lactose" before "milk", so "is the milk lactose-free?" asks about
 * lactose in milk.
 */
export const ASKED_ALLERGENS: { key: string; words: RegExp; freeFrom?: string; codes: string[] }[] =
	[
		{
			key: 'lactose',
			words: /\b(lactose\w*|laktoosi\w*)\b/i,
			freeFrom: 'LACTOSE',
			codes: ['ML', 'AM']
		},
		{ key: 'gluten', words: /\b(gluten\w*|gluteeni\w*)\b/i, freeFrom: 'GLUTEN', codes: ['AW'] },
		{ key: 'peanuts', words: /\b(peanuts?|maapähkinä\w*)\b/i, codes: ['AP'] },
		{ key: 'nuts', words: /\b(nuts?|tree nuts|pähkinä\w*)\b/i, codes: ['AN', 'SA', 'SH'] },
		{ key: 'egg', words: /\b(eggs?|kananmuna\w*|muna)\b/i, codes: ['AE'] },
		{ key: 'soy', words: /\b(soy|soya|soija\w*)\b/i, codes: ['AY'] },
		{ key: 'sesame', words: /\b(sesame|seesami\w*)\b/i, codes: ['AS'] },
		{ key: 'fish', words: /\b(fish|kala)\b/i, codes: ['AF'] },
		{ key: 'celery', words: /\b(celery|selleri\w*)\b/i, codes: ['BC'] },
		{ key: 'mustard', words: /\b(mustard|sinappi\w*)\b/i, codes: ['BM'] },
		{ key: 'milk', words: /\b(milk protein|milk|maitoa?)\b/i, freeFrom: 'MILK', codes: ['AM'] }
	];

/** The allergen asked about and the words left for the product, or null when none is named. */
function askedAllergen(text: string): { key: string; rest: string } | null {
	for (const a of ASKED_ALLERGENS) {
		const m = a.words.exec(text);
		if (!m) continue;
		const rest = text.replace(m[0], ' ').replace(/\b(free|free-from|-free|vapaa|ton|tön)\b/gi, ' ');
		// "milk" is the allergen only when another product word remains ("does the butter contain milk?").
		if (a.key === 'milk' && !/[\p{L}]{3,}/u.test(rest.replace(NOT_PRODUCT, ' '))) continue;
		return { key: a.key, rest };
	}
	return null;
}

/** A question this module answers, or null (the words go to the plan-based agent as before). */
export function readQuestion(text: string): Question | null {
	const t = text.trim();
	if (!t || isAuthorityImperative(t)) return null;
	const asking = isQuestion(t) || ASKING.test(t);
	if (!asking) return null;
	if (MANDATE_WORDS.test(t)) return { kind: 'mandate' };
	for (const [aspect, re] of ASPECTS) {
		if (!re.test(t)) continue;
		// The allergen asked about is not part of the product's name ("does kermavaahto contain gluten?").
		const asked = aspect === 'allergens' ? askedAllergen(t) : null;
		const query = (asked?.rest ?? t)
			.replace(/[?!.,;:"“”'’]/g, ' ')
			.replace(NOT_PRODUCT, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		// A question about the plan or an order is the agent's, not a product question.
		if (!query || /\b(plan|order|orders|event|lines?|approval|tilaus|suunnitelma)\b/i.test(query))
			return null;
		return { kind: 'product', aspect, query, ...(asked ? { allergen: asked.key } : {}) };
	}
	return null;
}

type Call = (name: ToolName, input: unknown) => Promise<Served>;

/** The gate, restricted to the answer tools. */
function gate(ctx: CallContext, handlers: ToolHandlers): Call {
	return async (name, input) => {
		if (!ANSWER_TOOLS.has(name)) throw new Error(`an answer may not call ${name}`);
		return serveTool(name, ctx, input, handlers);
	};
}

export async function answerQuestion(
	q: Question,
	ctx: CallContext,
	handlers: ToolHandlers,
	opts: { kitchenId?: string } = {}
): Promise<Answer> {
	const call = gate(ctx, handlers);
	return q.kind === 'mandate' ? answerMandate(call, opts.kitchenId) : answerProduct(call, q);
}

const euros = (cents: number) =>
	(cents / 100).toLocaleString('en-GB', {
		style: 'currency',
		currency: 'EUR',
		maximumFractionDigits: cents % 100 ? 2 : 0
	});

const NEVER_WORDS: Record<string, string> = {
	allergen_change: 'an allergen change',
	new_sku: 'a product the kitchen has not ordered before',
	substitute_breaks_preference: 'a substitute that breaks your preferences',
	off_tender_list: 'a product off the tender list',
	origin_requirement: 'breaking an origin requirement'
};

type ContextKitchen = {
	id: string;
	name: string;
	mandate: {
		words: string;
		lineCapCents: number;
		orderCapCents: number;
		weeklyCapCents: number;
		hardLimitCents: number;
		neverDelegate: string[];
		allergenFreeFrom: string[];
		tenderListOnly: boolean;
	};
	/** The kitchen's hard constraints (D16), when get_context carries them. */
	constraints?: {
		freeFrom: { code: string; name: string }[];
		origin: { categoryGroup: string; rule: 'prefer' | 'require'; country: string }[];
		notes: string[];
		unknownAllergenRecord: 'hold' | 'reject';
		traces: 'hold' | 'reject';
	};
};

/** The mandate in the chef's own words first, then the numbers the tools enforce. */
async function answerMandate(call: Call, kitchenId?: string): Promise<Answer> {
	const r = await call('get_context', {});
	if (!r.ok)
		return {
			steps: [
				{ tool: 'get_context', ok: false, summary: 'Could not read the mandate.', source: 'rules' }
			],
			text: `I could not read the mandate: ${r.error.message}`,
			sources: []
		};
	const all = (r.value as { kitchens: ContextKitchen[] }).kitchens;
	const kitchens = kitchenId ? all.filter((k) => k.id === kitchenId) : all;
	const shown = kitchens.length ? kitchens : all;
	const text = shown.map(mandateSentence).join('\n\n');
	return {
		steps: [
			{
				tool: 'get_context',
				ok: true,
				source: 'rules',
				summary:
					shown.length === 1
						? `Read the mandate for ${shown[0].name}.`
						: `Read the mandates for ${shown.length} kitchens.`
			}
		],
		text: `${text}\n\nOnly a chef changes the mandate, in the Kitchen screen; I work inside it.`,
		sources: []
	};
}

export function mandateSentence(k: ContextKitchen): string {
	const m = k.mandate;
	const never = m.neverDelegate.map((n) => NEVER_WORDS[n] ?? n.replace(/_/g, ' '));
	const parts = [
		`${k.name}: “${m.words}”`,
		`I may order alone up to ${euros(m.lineCapCents)} a line, ${euros(m.orderCapCents)} an order and ${euros(m.weeklyCapCents)} a week; more waits for a chef, and over ${euros(m.hardLimitCents)} is refused even with approval.`
	];
	if (never.length) parts.push(`Always asked first: ${never.join(', ')}.`);
	const c = k.constraints;
	const free = c ? c.freeFrom.map((x) => x.name) : m.allergenFreeFrom;
	if (free.length) parts.push(`Every product must be free from ${free.join(', ')}.`);
	if (c) {
		const required = c.origin.filter((o) => o.rule === 'require');
		if (required.length)
			parts.push(
				`Origin required: ${required.map((o) => `${country(o.country)} for category group ${o.categoryGroup}`).join('; ')}.`
			);
		if (free.length)
			parts.push(
				`A product with no allergen record is ${c.unknownAllergenRecord === 'reject' ? 'rejected' : 'held for a chef'}, never treated as allergen-free.`
			);
	}
	if (m.tenderListOnly) parts.push('Only products on the tender list.');
	return parts.join(' ');
}

const country = (code: string) => {
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
};

const productName = (p: Product) => p.nameEn ?? p.nameShort?.value ?? p.nameFi;

const factValue = (v: unknown) =>
	typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v);

const words = (t: string) =>
	t
		.toLowerCase()
		.split(/[^\p{L}\d]+/u)
		.filter(Boolean);
const names = (p: Product) =>
	[p.nameFi, p.nameEn, p.nameShort?.value].filter(Boolean).join(' ').toLowerCase();

type Picked =
	| { ok: true; product: Product; summary: string }
	| { ok: true; choices: Product[]; summary: string }
	| { ok: boolean; summary: string; text: string };

const named = (p: Product, w: string) => {
	const n = new Set(words(`${names(p)} ${p.brand ?? ''}`));
	return n.has(w) || (w.length >= 5 && [...n].some((x) => x.startsWith(w)));
};

/**
 * The products a question is about. A word the request page knows ("milk", "voi") searches with its catalogue word
 * inside its categories; a variant word ("whole" -> täysmaito) must be in the name; every other asked word (a brand,
 * "Arla") must be a whole word of the name or brand, so "butter" never lands on butternut squash and "Arla whole milk"
 * never on Valio semi-skimmed. The lexicon's default variant never picks: more than one match is the chef's choice.
 */
async function pickProduct(call: Call, query: string, productId?: string): Promise<Picked> {
	const asked = words(query);
	const known = PRODUCTS.find((w) => asked.some((a) => w.forms.includes(a)));
	const variant = known?.variants?.find((v) => v.words.some((w) => asked.includes(w)));
	const explicit = asked.filter(
		(a) => !known?.forms.includes(a) && !variant?.words.includes(a) && a.length > 1
	);
	// A picked product is found by its own name (the query); otherwise the lexicon word and the words asked.
	const searches = [
		...new Set((productId ? [query] : [known?.search, query]).filter((q): q is string => !!q))
	];
	const found = new Map<string, Product>();
	let failed: string | null = null;
	for (const q of searches) {
		const s = await call('search_products', { query: q, limit: 50 });
		if (!s.ok) failed = s.error.message;
		else for (const p of (s.value as { products: Product[] }).products) found.set(p.productId, p);
	}
	if (!found.size && failed)
		return {
			ok: false,
			summary: 'The catalogue search failed.',
			text: `I could not search the catalogue: ${failed}`
		};
	let hits = [...found.values()];
	if (productId) {
		const p = hits.find((x) => x.productId === productId);
		return p
			? { ok: true, product: p, summary: `Found ${productName(p)}.` }
			: {
					ok: true,
					summary: 'That product is not in the catalogue any more.',
					text: 'I could not find that product in the catalogue any more; ask again by its name.'
				};
	}
	if (known?.categories) hits = hits.filter((p) => known.categories!.includes(p.category));
	if (variant) hits = hits.filter((p) => names(p).includes(variant.token));
	const near = hits;
	hits = hits.filter((p) => explicit.every((w) => named(p, w)));
	if (!hits.length) {
		const close = (near.length ? near : [...found.values()]).slice(0, 3).map(productName);
		return close.length
			? {
					ok: true,
					summary: `No product is named “${query}”; closest: ${close.join(', ')}.`,
					text: `I'm not sure which product you mean by “${query}”. The closest catalogue names are ${close.join(', ')}. Ask again with the product's name as the catalogue has it.`
				}
			: {
					ok: true,
					summary: `No catalogue product matches “${query}”.`,
					text: `I found no product for “${query}” in the Valio catalogue. Name it as the catalogue does, for example “kermavaahto” or “voi”.`
				};
	}
	if (hits.length > 1)
		return { ok: true, choices: hits, summary: `${hits.length} products match “${query}”.` };
	return { ok: true, product: hits[0], summary: `Found ${productName(hits[0])}.` };
}

/** At most this many "Which one?" buttons; more matches ask for a closer name. */
const MAX_CHOICES = 4;

/**
 * "Does X contain <allergen>?" from the catalogue record. Lactose, milk and gluten go through core's one evaluator
 * (meets, D16), the same rule the validator enforces; other allergens read the allergen record. No record is unknown,
 * never "free from".
 */
function allergenAnswer(steps: AnswerStep[], p: Product, name: string, key: string): Answer {
	const a = ASKED_ALLERGENS.find((x) => x.key === key)!;
	if (a.freeFrom) {
		const r = meets(p, { freeFrom: [a.freeFrom] });
		const why = r.failing[0]?.why;
		const text =
			r.verdict === 'ok'
				? `Yes, ${name} is free from ${key}, according to Valio's catalogue.`
				: r.verdict === 'no'
					? `No: ${name} is not free from ${key} (${why ?? 'the catalogue record'}).`
					: `Unknown: Valio has no allergen record for ${name}, so it counts as possibly containing ${key}. A kitchen excluding ${key} holds it for a chef.`;
		return { steps, text, sources: [] };
	}
	const rec = p.allergens;
	const hit = (list: string[]) => list.some((c) => a.codes.includes(c));
	const text = !rec.declared
		? `Unknown: Valio has no allergen record for ${name}, so it may contain ${key}; it is never assumed free.`
		: hit(rec.contains)
			? `Yes: ${name} contains ${key}, according to its allergen record.`
			: hit(rec.mayContain)
				? `It may contain traces of ${key}, according to its allergen record.`
				: `Its allergen record declares no ${key}.`;
	return { steps, text, sources: [] };
}

async function answerProduct(
	call: Call,
	q: Extract<Question, { kind: 'product' }>
): Promise<Answer> {
	const steps: AnswerStep[] = [];
	const picked = await pickProduct(call, q.query, q.productId);
	steps.push({ tool: 'search_products', ok: picked.ok, summary: picked.summary, source: 'rules' });
	if ('text' in picked) return { steps, text: picked.text, sources: [] };
	if ('choices' in picked) {
		const c = picked.choices;
		// One origin for every match is an answer for all of them; anything else is the chef's pick first.
		const origins = new Set(c.map((x) => x.origin?.toUpperCase() ?? ''));
		if (q.aspect === 'origin' && origins.size === 1 && !origins.has(''))
			return {
				steps,
				text: `All ${c.length} matching products come from ${country([...origins][0])}, according to Valio's catalogue: ${c
					.slice(0, 6)
					.map(productName)
					.join(', ')}${c.length > 6 ? ', …' : ''}.`,
				sources: []
			};
		return {
			steps,
			text:
				c.length > MAX_CHOICES
					? `${c.length} products match “${q.query}”. Which one? The first ${MAX_CHOICES} are below; or name it more closely (brand, fat level, size).`
					: `${c.length} products match “${q.query}”. Which one?`,
			sources: [],
			choices: c
				.slice(0, MAX_CHOICES)
				.map((x) => ({ label: productName(x), value: choiceValue(q.aspect, x) }))
		};
	}
	const p = picked.product;
	const name = productName(p);

	if (q.aspect === 'recall') {
		const r = await call('check_recall', { productId: p.productId });
		if (!r.ok) {
			steps.push({
				tool: 'check_recall',
				ok: false,
				summary: 'The recall watch could not be read.',
				source: 'cache'
			});
			return {
				steps,
				text: `I could not check recalls for ${name}: ${r.error.message}`,
				sources: []
			};
		}
		const all = (
			r.value as {
				notices: { url: string; title: string; match: string; seenAt: string; drill: boolean }[];
			}
		).notices;
		// A drill is a rehearsal notice, never a recall: said as such, never counted.
		const notices = all.filter((n) => !n.drill);
		const drills = all.filter((n) => n.drill && n.match !== 'none');
		const byGtin = notices.filter((n) => n.match === 'gtin');
		const byName = notices.filter((n) => n.match === 'name');
		const cite = (n: (typeof notices)[number]) =>
			`Recall notice from ${hostOf(n.url) ?? 'the watch'}${shortDay(n.seenAt) ? `, ${shortDay(n.seenAt)}` : ''}: ${n.title}`;
		steps.push({
			tool: 'check_recall',
			ok: true,
			// The watch's notices are stored as the monitor read them; this call reads no network.
			source: 'cache',
			summary: byGtin.length
				? `${byGtin.length} recall notice(s) cite its GTIN.`
				: byName.length
					? `${byName.length} notice(s) mention the name only.`
					: 'No recall found in the notices we monitor.'
		});
		// Never "safe": the watch covers the notices we monitor, not every recall there is.
		const text = byGtin.length
			? `${cite(byGtin[0])}. It cites ${name} by its GTIN: don't use it until a chef has checked the notice.`
			: byName.length
				? `${cite(byName[0])}. It names a product like ${name} but not its GTIN, so it may be a different product; check the notice before using it.`
				: `No recall found in the notices we monitor for ${name}.`;
		const drill = drills.length
			? ' (A recall drill also names it; drills are rehearsals, not recalls.)'
			: '';
		return {
			steps,
			text: text + drill,
			sources: [...byGtin, ...byName].map((n) => source(n.url, n.title))
		};
	}

	if (q.aspect === 'origin' && p.origin)
		return {
			steps,
			text: `${name} comes from ${country(p.origin)}, according to Valio's catalogue.`,
			sources: []
		};

	if (q.aspect === 'allergens' && q.allergen) return allergenAnswer(steps, p, name, q.allergen);
	if (q.aspect === 'allergens' && p.allergens.declared) {
		const a = p.allergens;
		const named = (codes: string[]) => codes.map((c) => ALLERGEN_NAMES[c] ?? c).join(', ');
		const bits = [
			a.contains.length ? `contains ${named(a.contains)}` : 'declares no allergens it contains',
			a.mayContain.length ? `may contain ${named(a.mayContain)}` : '',
			p.freeFrom.length ? `is labelled free from ${p.freeFrom.join(', ')}` : ''
		].filter(Boolean);
		return {
			steps,
			text: `According to Valio's catalogue, ${name} ${bits.join('; ')}.`,
			sources: []
		};
	}

	// The catalogue is silent on this, or the question is open: sourced web facts, labelled as such.
	const question =
		q.aspect === 'origin'
			? 'country of origin'
			: q.aspect === 'allergens'
				? 'allergens'
				: undefined;
	const f = await call('lookup_facts', {
		productId: p.productId,
		...(question ? { question } : {})
	});
	const silent =
		q.aspect === 'allergens'
			? `Valio has no allergen record for ${name}, and absent is not allergen-free.`
			: q.aspect === 'origin'
				? `Valio's catalogue states no origin for ${name}.`
				: '';
	if (!f.ok) {
		steps.push({
			tool: 'lookup_facts',
			ok: false,
			summary: 'The web lookup did not answer.',
			source: 'live'
		});
		return {
			steps,
			text: `${silent} I could not look it up on the web: ${f.error.message}`.trim(),
			sources: []
		};
	}
	const facts = (
		f.value as {
			facts: {
				field: string;
				value: unknown;
				gtinCited: boolean;
				sources: { url: string; title?: string }[];
			}[];
		}
	).facts;
	steps.push({
		tool: 'lookup_facts',
		ok: true,
		source: webSource(f),
		summary: facts.length
			? `Found ${facts.length} sourced fact(s) on the web.`
			: 'The web had nothing sourced.'
	});
	if (!facts.length)
		return {
			steps,
			text: `${silent} The web had nothing sourced about it either.`.trim(),
			sources: []
		};
	const lines = facts.slice(0, 4).map((x) => {
		const from = x.sources[0] ? hostOf(x.sources[0].url) : undefined;
		return `${x.field.replace(/_/g, ' ')}: ${factValue(x.value)}${from ? ` (${from}${x.gtinCited ? '' : ', names the product, not its GTIN'})` : ''}`;
	});
	return {
		steps,
		text: `${silent} From the web, as a suggestion (Valio's catalogue wins where it says otherwise): ${lines.join('; ')}.`.trim(),
		sources: facts
			.flatMap((x) => x.sources)
			.slice(0, 6)
			.map((x) => source(x.url, x.title))
	};
}
