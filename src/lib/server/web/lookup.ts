/**
 * Exa discovery for the purchasing flow. Two questions the catalogue can't answer by itself:
 * - `lookupFacts`: a product's missing facts (allergens, net content, origin, ingredients) from
 *   manufacturer and retailer pages, as suggestions with sources and quotes (D6: never facts).
 * - `findOutside`: when nothing deliverable fits a need, recipes or alternatives from the web, each
 *   ingredient mapped back to catalogue products the kitchen can order.
 */
import type { Actor, PendingOp, Product } from '$lib/core/contracts';
import type { Catalog, Store } from '$lib/core/ports';
import type { FactSearch, Grounding, ExaResult } from './exa';
import type { Findings } from './findings';

export type FactField = 'allergens' | 'mayContain' | 'netContent' | 'origin' | 'ingredients';

export interface Source {
	url: string;
	title?: string;
	/** Excerpt from the page that carries the fact (Exa highlight). */
	quote?: string;
	/** The page names this product's GTIN (in its URL or text), so it's about this exact item. */
	gtinOnPage: boolean;
}

export interface Suggestion {
	field: FactField;
	value: unknown;
	/** Exa's grounding label for the field ("high", "medium", "low"). */
	grounding?: string;
	/** gtin: a citing page names this GTIN; name: cited pages match by name only (weaker). */
	verified: 'gtin' | 'name';
	sources: Source[];
}

export interface FactsResult {
	key: string;
	productId?: string;
	productName?: string;
	gtin?: string;
	query: string;
	/** What the catalogue says already, so the UI can show "catalogue: unknown → web suggests …". */
	catalogue: Partial<Record<FactField, unknown>>;
	suggestions: Suggestion[];
	results: ExaResult[];
	mode: 'live' | 'fixture';
	at: string;
	cached: boolean;
	latencyMs: number;
	costUsd?: number;
	/** Seqs of the RecordEnrichment ops written, when a product and a store were given. */
	recorded: number[];
	note: string;
}

const FACTS_SCHEMA = {
	type: 'object',
	properties: {
		allergens: {
			type: 'array',
			items: { type: 'string' },
			description: 'allergens the product contains, as stated on the page'
		},
		mayContain: { type: 'array', items: { type: 'string' } },
		netContent: { type: ['string', 'null'] },
		origin: { type: ['string', 'null'], description: 'country of origin or manufacture' },
		ingredients: { type: ['string', 'null'] }
	},
	required: ['allergens', 'mayContain', 'netContent', 'origin', 'ingredients']
};

function catalogueFacts(p: Product): FactsResult['catalogue'] {
	return {
		allergens: p.allergens.declared ? p.allergens.contains : null,
		mayContain: p.allergens.declared ? p.allergens.mayContain : null,
		netContent: p.netPerSalesUnit
			? `${p.netPerSalesUnit.value.value} ${p.netPerSalesUnit.value.unit}`
			: null,
		origin: p.origin ?? null,
		ingredients: null
	};
}

/** Builds sources for a field from Exa grounding, attaching quotes and the GTIN check from results. */
export function sourcesFor(
	field: string,
	grounding: Grounding[],
	results: ExaResult[],
	gtin?: string
): Source[] {
	const cites = grounding
		.filter(
			(g) => g.field === field || g.field.startsWith(`${field}[`) || g.field.startsWith(`${field}.`)
		)
		.flatMap((g) => g.citations);
	const seen = new Set<string>();
	return cites
		.filter((c) => !seen.has(c.url) && seen.add(c.url))
		.map((c) => {
			const r = results.find((x) => x.url === c.url);
			const text = `${c.url} ${(r?.highlights ?? []).join(' ')}`;
			return {
				url: c.url,
				title: c.title ?? r?.title,
				quote: r?.highlights?.[0]?.slice(0, 400),
				gtinOnPage: !!gtin && text.includes(gtin)
			};
		});
}

export interface LookupDeps {
	exa: FactSearch;
	catalog: Catalog;
	findings: Findings;
	/** With a store and scope, suggestions are written as RecordEnrichment ops in the current run. */
	store?: Store;
	scope?: { workspaceId: string; runId: string };
	actor?: Actor;
	via?: string;
}

export async function lookupFacts(
	input: { productId?: string; query?: string },
	d: LookupDeps
): Promise<FactsResult> {
	const product = input.productId
		? (await d.catalog.get([input.productId])).get(input.productId)
		: undefined;
	if (input.productId && !product) throw new Error(`unknown product ${input.productId}`);
	const name = product?.nameFi ?? input.query ?? '';
	if (!name.trim()) throw new Error('give a productId or a query');
	const gtin = product?.gtin;
	const query = `${name}${gtin ? ` ${gtin}` : ''} ainesosat allergeenit`;
	const key = product ? `facts:${product.productId}` : `facts:q:${slug(name)}`;

	const r = await d.exa.structured<Record<FactField, unknown>>({
		key,
		query,
		systemPrompt:
			"Prefer the manufacturer's own product page, then wholesaler or retailer product pages for this exact product (same GTIN or same name and size). Report only facts stated on the pages; null or [] when not stated. Never mix in a sibling product.",
		schema: FACTS_SCHEMA,
		highlightsQuery: 'ainesosat allergeenit sisältää alkuperä nettopaino',
		numResults: 5
	});

	const suggestions: Suggestion[] = [];
	for (const field of [
		'allergens',
		'mayContain',
		'netContent',
		'origin',
		'ingredients'
	] as FactField[]) {
		const value = r.content?.[field];
		if (value === null || value === undefined) continue;
		const sources = sourcesFor(field, r.grounding, r.results, gtin);
		if (!sources.length) continue; // no citation, no suggestion
		suggestions.push({
			field,
			value,
			grounding: r.grounding.find((g) => g.field === field)?.confidence,
			verified: sources.some((s) => s.gtinOnPage) ? 'gtin' : 'name',
			sources
		});
	}

	let recorded: number[] = [];
	if (product && d.store && d.scope && suggestions.length) {
		const actor = d.actor ?? { kind: 'system', id: 'web:exa' };
		const scope = d.scope;
		const res = await d.store.transact(scope.workspaceId, async (_tx, state) => {
			const have = state.enrichments[product.productId] ?? {};
			const ops: PendingOp[] = suggestions
				.filter((s) => {
					const prev = have[`web.${s.field}`];
					return (
						!prev ||
						JSON.stringify((prev.value as { value?: unknown })?.value) !== JSON.stringify(s.value)
					);
				})
				.map((s) => ({
					workspaceId: scope.workspaceId,
					runId: state.runId,
					actor,
					via: d.via ?? 'web:exa',
					op: {
						type: 'RecordEnrichment',
						productId: product.productId,
						field: `web.${s.field}`,
						value: { value: s.value, verified: s.verified, sources: s.sources.map((x) => x.url) },
						provenance: {
							source: 'web',
							ref: s.sources[0].url,
							at: r.at,
							note: `Exa search (outputSchema); suggestion, not a catalogue fact; ${s.verified === 'gtin' ? 'page names this GTIN' : 'matched by name only'}`
						}
					}
				}));
			return { ops, value: null };
		});
		if (res.ok) recorded = res.value.ops.map((e) => e.seq);
	}

	const out: FactsResult = {
		key,
		productId: product?.productId,
		productName: product?.nameFi,
		gtin,
		query,
		catalogue: product ? catalogueFacts(product) : {},
		suggestions,
		results: r.results,
		mode: d.exa.mode,
		at: r.at,
		cached: r.cached,
		latencyMs: r.latencyMs,
		costUsd: r.costUsd,
		recorded,
		note: suggestions.length
			? 'Suggestions from the web with their sources. They stay suggestions until a person confirms them; catalogue facts are never overwritten.'
			: d.exa.mode === 'fixture'
				? 'No recorded answer for this product in fixture mode.'
				: 'No cited facts found.'
	};
	d.findings.put({
		id: key,
		kind: 'facts',
		at: new Date().toISOString(),
		title: `Facts for ${name}`,
		sources: [...new Set(suggestions.flatMap((s) => s.sources.map((x) => x.url)))],
		ops: recorded.length && d.scope ? [{ runId: d.scope.runId, seqs: recorded }] : [],
		data: { suggestions, catalogue: out.catalogue, query }
	});
	return out;
}

export interface OutsideOption {
	title: string;
	kind: 'recipe' | 'ready_made' | 'alternative_dish';
	yield: string | null;
	note: string | null;
	ingredients: { text: string; catalogue: { productId: string; name: string }[] }[];
	sources: Source[];
}

const OUTSIDE_SCHEMA = {
	type: 'object',
	properties: {
		options: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					kind: { type: 'string', enum: ['recipe', 'ready_made', 'alternative_dish'] },
					ingredients: { type: 'array', items: { type: 'string' } },
					yield: { type: ['string', 'null'] },
					note: { type: ['string', 'null'] }
				},
				required: ['title', 'kind', 'ingredients', 'yield', 'note']
			}
		}
	},
	required: ['options']
};

/**
 * "1 kg lehtitaikinalevyjä (10 kpl)" → ["lehtitaikinalevyjä", "lehtitaikinal", "lehtitaikin", …]: the first
 * content word, then shorter stems (Finnish inflection and compounds), tried in order as catalogue searches.
 */
export function ingredientTerms(text: string): string[] {
	const w = text
		.toLowerCase()
		.replace(/\(.*?\)/g, ' ')
		.replace(/[^a-zåäö\s-]/g, ' ')
		.split(/\s+/)
		.filter((x) => x.length > 3 && !x.endsWith('-') && !UNITS.has(x))[0];
	if (!w) return [];
	const out = [w];
	for (const f of [0.75, 0.6, 0.5]) {
		const n = Math.max(5, Math.round(w.length * f));
		if (n < out[out.length - 1].length) out.push(w.slice(0, n));
	}
	return out;
}
/**
 * Catalogue hits ordered by stem length minus how late in the name the matching word starts, then name
 * length: "Kieku Luomu kananmuna" before "Barilla Tagliatelle pasta, sisältää kananmunaa"
 * and before "Atria Kanan Koipi".
 */
export function rankByWord(hits: Product[], terms: string[]): Product[] {
	const score = (p: Product) => {
		const words = p.nameFi.toLowerCase().split(/[\s,]+/);
		for (const t of terms) {
			const i = words.findIndex((w) => w.startsWith(t));
			if (i >= 0) return Math.max(1, t.length * 10 - i * 15);
		}
		return 0;
	};
	return hits
		.map((p) => ({ p, s: score(p) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s || a.p.nameFi.length - b.p.nameFi.length)
		.map((x) => x.p);
}
const UNITS = new Set([
	'esim',
	'noin',
	'tai',
	'ja',
	'paistonkestävää',
	'valmis',
	'valmista',
	'tuoretta',
	'pakaste'
]);

export async function findOutside(
	need: string,
	d: { exa: FactSearch; catalog: Catalog; findings: Findings; context?: string }
) {
	const key = `outside:${slug(need)}`;
	const r = await d.exa.structured<{
		options?: Omit<OutsideOption, 'ingredients' | 'sources'>[] & { ingredients: string[] }[];
	}>({
		key,
		query: `${need} resepti suurkeittiö isolle määrälle`,
		systemPrompt: `A professional kitchen needs "${need}"${d.context ? ` (${d.context})` : ''} and its wholesaler has nothing deliverable. Find recipes that scale to a large batch, or ready-made alternatives. Report only what pages state.`,
		schema: OUTSIDE_SCHEMA,
		numResults: 5
	});
	const options: OutsideOption[] = [];
	const raw = (r.content?.options ?? []) as unknown as {
		title: string;
		kind: OutsideOption['kind'];
		ingredients: string[];
		yield: string | null;
		note: string | null;
	}[];
	for (const [i, o] of raw.entries()) {
		const ingredients = [];
		for (const text of o.ingredients ?? []) {
			// Every stem's hits, ranked together on the shortest stem (Finnish inflection).
			const terms = ingredientTerms(text);
			const pool = new Map<string, Product>();
			for (const term of terms)
				for (const p of await d.catalog.search(term, { limit: 40 })) pool.set(p.productId, p);
			const hits = rankByWord([...pool.values()], terms).slice(0, 3);
			ingredients.push({
				text,
				catalogue: hits.map((p) => ({ productId: p.productId, name: p.nameFi }))
			});
		}
		options.push({
			title: o.title,
			kind: o.kind,
			yield: o.yield,
			note: o.note,
			ingredients,
			sources: sourcesFor(`options[${i}]`, r.grounding, r.results)
		});
	}
	const out = {
		key,
		need,
		options,
		results: r.results,
		mode: d.exa.mode,
		at: r.at,
		cached: r.cached,
		latencyMs: r.latencyMs,
		costUsd: r.costUsd,
		note: options.length
			? 'Options from the web with sources. Ingredients are matched to catalogue products by name; a person picks.'
			: d.exa.mode === 'fixture'
				? 'No recorded answer for this need in fixture mode.'
				: 'Nothing found.'
	};
	d.findings.put({
		id: key,
		kind: 'outside',
		at: new Date().toISOString(),
		title: `Outside options for ${need}`,
		sources: [...new Set(options.flatMap((o) => o.sources.map((s) => s.url)))],
		data: { options }
	});
	return out;
}

export function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 60);
}
