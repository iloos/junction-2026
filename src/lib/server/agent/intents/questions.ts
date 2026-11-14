/**
 * Questions the chef asks the agent that need no plan: what the mandate allows, and what is true about one catalogue
 * product (a recall, its origin, its allergens, other facts). Read deterministically before any model call, answered
 * with read-scope tools only through the one gate (`serveTool`), so an answer can never order, plan or approve.
 *
 * Catalogue facts come first; the web (lookup_facts, the recall watch) adds sourced evidence and never overrides them.
 */
import type { Product, ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { serveTool, type Served } from '$lib/server/tools/serve';
import { isAuthorityImperative, isQuestion } from '../classify';

export type ProductAspect = 'recall' | 'origin' | 'allergens' | 'facts';

export type Question =
	{ kind: 'mandate' } | { kind: 'product'; aspect: ProductAspect; query: string };

export interface AnswerStep {
	tool: ToolName;
	ok: boolean;
	/** What the step found, in the chef's words. */
	summary: string;
}

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
		/\b(origin|where (is|are|does|do) .+ (from|made|produced)|made in|produced in|country|alkuperä\w*|mistä)\b/i
	],
	[
		'allergens',
		/\b(allergen\w*|gluten|lactose|milk protein|nuts?|contain|contains|may contain|allergeen\w*|sisältää|gluteeni\w*|laktoosi\w*)\b/i
	],
	['facts', /\b(facts?|tell me about|what is in|ingredients?|nutrition|ainesosa\w*|tietoja)\b/i]
];

/** Words that are about the question, not the product; stripped to leave the product's name. */
const NOT_PRODUCT =
	/\b(is|are|was|the|a|an|our|my|this|that|any|there|does|do|has|have|it|its|of|in|on|for|from|with|me|about|tell|what|whats|what's|which|where|show|explain|please|can|you|check|still|ok|okay|safe|use|made|produced|country|origin|recall|recalls|recalled|withdrawn|allergen\w*|contain|contains|may|facts?|ingredients?|nutrition|onko|mikä|mitä|mistä|kerro|näytä|takaisinve\w*|takaisinkutsu\w*|alkuperä\w*|sisältää|tietoja|ainesosa\w*)\b/gi;

/** A question this module answers, or null (the words go to the plan-based agent as before). */
export function readQuestion(text: string): Question | null {
	const t = text.trim();
	if (!t || isAuthorityImperative(t)) return null;
	const asking = isQuestion(t) || ASKING.test(t);
	if (!asking) return null;
	if (MANDATE_WORDS.test(t)) return { kind: 'mandate' };
	for (const [aspect, re] of ASPECTS) {
		if (!re.test(t)) continue;
		// Allergen words also name the product's own dietary label ("lactose-free cream"); the rest is the product.
		const query = t
			.replace(/[?!.,;:"“”'’]/g, ' ')
			.replace(NOT_PRODUCT, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		// A question about the plan or an order is the agent's, not a product question.
		if (!query || /\b(plan|order|orders|event|lines?|approval|tilaus|suunnitelma)\b/i.test(query))
			return null;
		return { kind: 'product', aspect, query };
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
};

/** The mandate in the chef's own words first, then the numbers the tools enforce. */
async function answerMandate(call: Call, kitchenId?: string): Promise<Answer> {
	const r = await call('get_context', {});
	if (!r.ok)
		return {
			steps: [{ tool: 'get_context', ok: false, summary: 'Could not read the mandate.' }],
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
	if (m.allergenFreeFrom.length) parts.push(`Must be free from: ${m.allergenFreeFrom.join(', ')}.`);
	if (m.tenderListOnly) parts.push('Only products on the tender list.');
	return parts.join(' ');
}

const country = (code: string) => {
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
	} catch {
		return code;
	}
};

const productName = (p: Product) => p.nameEn ?? p.nameShort?.value ?? p.nameFi;

const factValue = (v: unknown) =>
	typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v);

async function answerProduct(
	call: Call,
	q: Extract<Question, { kind: 'product' }>
): Promise<Answer> {
	const steps: AnswerStep[] = [];
	const s = await call('search_products', { query: q.query, limit: 3 });
	const products = s.ok ? (s.value as { products: Product[] }).products : [];
	if (!products.length) {
		steps.push({
			tool: 'search_products',
			ok: s.ok,
			summary: s.ok ? `No catalogue product matches “${q.query}”.` : 'The catalogue search failed.'
		});
		return {
			steps,
			text: `I found no product for “${q.query}” in the Valio catalogue. Name it as the catalogue does, for example “kermavaahto” or “Valio butter”.`,
			sources: []
		};
	}
	const p = products[0];
	const name = productName(p);
	const others =
		products.length > 1 ? ` (also matched: ${products.slice(1).map(productName).join(', ')})` : '';
	steps.push({ tool: 'search_products', ok: true, summary: `Found ${name}${others}.` });

	if (q.aspect === 'recall') {
		const r = await call('check_recall', { productId: p.productId });
		if (!r.ok) {
			steps.push({
				tool: 'check_recall',
				ok: false,
				summary: 'The recall watch could not be read.'
			});
			return {
				steps,
				text: `I could not check recalls for ${name}: ${r.error.message}`,
				sources: []
			};
		}
		const notices = (
			r.value as { notices: { url: string; title: string; match: string; seenAt: string }[] }
		).notices;
		const byGtin = notices.filter((n) => n.match === 'gtin');
		const byName = notices.filter((n) => n.match === 'name');
		const cite = (n: (typeof notices)[number]) =>
			`Recall notice from ${hostOf(n.url) ?? 'the watch'}${shortDay(n.seenAt) ? `, ${shortDay(n.seenAt)}` : ''}: ${n.title}`;
		steps.push({
			tool: 'check_recall',
			ok: true,
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
		return {
			steps,
			text,
			sources: [...byGtin, ...byName].map((n) => source(n.url, n.title))
		};
	}

	if (q.aspect === 'origin' && p.origin)
		return {
			steps,
			text: `${name} comes from ${country(p.origin)}, according to Valio's catalogue.`,
			sources: []
		};

	if (q.aspect === 'allergens' && p.allergens.declared) {
		const a = p.allergens;
		const bits = [
			a.contains.length ? `contains ${a.contains.join(', ')}` : 'declares no allergens it contains',
			a.mayContain.length ? `may contain ${a.mayContain.join(', ')}` : '',
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
		steps.push({ tool: 'lookup_facts', ok: false, summary: 'The web lookup did not answer.' });
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
