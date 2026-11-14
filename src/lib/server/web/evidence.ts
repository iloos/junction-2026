/**
 * Web evidence shaped for the UI (the Why drawer, the Ops card). Each view says where its answer came from
 * (`live` = sent now, `cache` = an earlier live answer, `replay` = a recorded real response in fixture mode)
 * and keeps D10: a source supports an identity or a field, never safety or supply, and nothing here changes a
 * plan or a catalogue fact.
 * - `factsEvidence`: "Valio has no allergen record" → web fields with citations, quotes and a GTIN check.
 * - `makeInHouse`: an unresolved need → an outside recipe → each ingredient resolved against the catalogue →
 *   a make-in-house proposal that is always held for sign-off.
 * - `supplierLeads`: recent news on the plan's suppliers, as leads for a person (never a hold).
 */
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import type { FactsResult, FactField, OutsideOption } from './lookup';
import { findOutside } from './lookup';
import type { FactSearch } from './exa';
import type { Findings } from './findings';
import type { NewsArticle, NewsSource } from './contextdev';

export type EvidenceSource = 'live' | 'cache' | 'replay';
export const evidenceSource = (mode: 'live' | 'fixture', cached: boolean): EvidenceSource =>
	mode === 'fixture' ? 'replay' : cached ? 'cache' : 'live';

const FIELD_LABEL: Record<FactField, string> = {
	allergens: 'Allergens',
	mayContain: 'May contain',
	netContent: 'Net content',
	origin: 'Origin',
	ingredients: 'Ingredients'
};

export interface WhyEvidence {
	productId: string;
	productName: string;
	gtin?: string;
	/** What the catalogue says, in words ("no allergen record", "declares: maito"). */
	catalogue: string;
	/** The gap this evidence answers; null when the catalogue already has a record. */
	gap: 'no_allergen_record' | null;
	source: EvidenceSource;
	at: string;
	fields: {
		field: FactField;
		label: string;
		value: string;
		/** Exa's grounding label ("high", "medium", "low"). */
		grounding?: string;
		/** A cited page or its excerpt names this product's GTIN: probably this exact item. */
		gtinCited: boolean;
		sources: { url: string; host: string; title?: string; quote?: string; gtinCited: boolean }[];
	}[];
	/** Shown under the fields, always. */
	disclaimer: string;
	note: string;
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));
const host = (u: string) => {
	try {
		return new URL(u).host.replace(/^www\./, '');
	} catch {
		return u;
	}
};

/** An Exa excerpt as one readable line: markdown table pipes, rules and headings dropped. */
export const cleanQuote = (q: string) =>
	q
		.replace(/^#+\s*/gm, '')
		.replace(/\|?\s*-{3,}\s*\|?/g, ' ')
		.replace(/\s*\|\s*/g, ' · ')
		.replace(/(\s*·\s*)+/g, ' · ')
		.replace(/\s+/g, ' ')
		.replace(/^\s*·\s*|\s*·\s*$/g, '')
		.trim();

export function factsEvidence(r: FactsResult): WhyEvidence {
	const declared = r.catalogue.allergens;
	const gap = declared === null || declared === undefined ? 'no_allergen_record' : null;
	return {
		productId: r.productId,
		productName: r.productName,
		gtin: r.gtin,
		catalogue: gap
			? 'Valio has no allergen record for this product'
			: `Valio declares: ${show(declared) || 'no allergens'}`,
		gap,
		source: evidenceSource(r.mode, r.cached),
		at: r.at,
		// GTIN-cited fields first: they are about this exact item.
		fields: [...r.suggestions]
			.sort((a, b) => Number(b.gtinCited) - Number(a.gtinCited))
			.map((s) => ({
				field: s.field,
				label: FIELD_LABEL[s.field],
				value: show(s.value).slice(0, 600),
				grounding: s.grounding,
				gtinCited: s.gtinCited,
				sources: s.sources.slice(0, 5).map((x) => ({
					url: x.url,
					host: host(x.url),
					title: x.title,
					quote: x.quote && cleanQuote(x.quote),
					gtinCited: x.gtinCited
				}))
			})),
		disclaimer:
			'Web suggestions for a person to check against the pack. They never clear a hold or replace a catalogue fact.',
		note: r.note
	};
}

export interface MakeInHouseProposal {
	need: string;
	source: EvidenceSource;
	at: string;
	/** Always held: a recipe from the web is a new way to cover the dish, so a person signs it off. */
	status: 'held';
	reasons: ('new_sku' | 'allergen_change')[];
	recipe: {
		title: string;
		yield: string | null;
		note: string | null;
		url: string;
		host: string;
	} | null;
	ingredients: {
		text: string;
		/** `resolved`: the catalogue resolver found products; `nearest`: only near misses; `none`: nothing. */
		status: 'resolved' | 'nearest' | 'none';
		products: { productId: string; name: string }[];
		reason?: string;
	}[];
	/** Ingredients with a resolved product, of all ingredients. */
	coverage: { resolved: number; total: number };
	alternatives: { title: string; url: string }[];
	note: string;
}

/**
 * Unresolved need → outside recipe → catalogue ingredients → held make-in-house proposal. The recipe with the
 * most resolvable ingredients wins; ingredients use `Catalog.resolve` when the catalogue has it (it says why
 * nothing qualifies), else the name matches `findOutside` already made.
 */
export async function makeInHouse(
	need: string,
	d: {
		exa: FactSearch;
		catalog: Catalog;
		findings: Findings;
		context?: string;
		workspaceId?: string;
	}
): Promise<MakeInHouseProposal> {
	const r = await findOutside(need, d);
	const recipes = r.options.filter((o) => o.kind === 'recipe' && o.sources.length);
	const scored = await Promise.all(
		recipes.map(async (o) => ({ o, ing: await resolveAll(o, d.catalog) }))
	);
	scored.sort(
		(a, b) =>
			b.ing.filter((x) => x.status === 'resolved').length -
				a.ing.filter((x) => x.status === 'resolved').length || b.ing.length - a.ing.length
	);
	const best = scored[0];
	const resolved = best?.ing.filter((x) => x.status === 'resolved').length ?? 0;
	return {
		need,
		source: evidenceSource(r.mode, r.cached),
		at: r.at,
		status: 'held',
		reasons: ['new_sku', 'allergen_change'],
		recipe: best
			? {
					title: best.o.title,
					yield: best.o.yield,
					note: best.o.note,
					url: best.o.sources[0].url,
					host: host(best.o.sources[0].url)
				}
			: null,
		ingredients: best?.ing ?? [],
		coverage: { resolved, total: best?.ing.length ?? 0 },
		alternatives: r.options
			.filter((o) => o !== best?.o && o.sources.length)
			.slice(0, 4)
			.map((o) => ({ title: o.title, url: o.sources[0].url })),
		note: best
			? `A recipe from ${host(best.o.sources[0].url)}; ${resolved} of ${best.ing.length} ingredients resolve to catalogue products. Held for sign-off: quantities and allergens need a chef's check.`
			: r.note
	};
}

async function resolveAll(
	o: OutsideOption,
	catalog: Catalog
): Promise<MakeInHouseProposal['ingredients']> {
	const out: MakeInHouseProposal['ingredients'] = [];
	for (const ing of o.ingredients) {
		if (catalog.resolve) {
			const res = await catalog.resolve(ing.text, { limit: 3 });
			const ids =
				res.status === 'resolved'
					? res.candidates.map((c) => c.productId)
					: res.nearest.map((n) => n.productId).slice(0, 3);
			const names = ids.length ? await catalog.get(ids) : new Map<string, Product>();
			out.push({
				text: ing.text,
				status: res.status === 'resolved' ? 'resolved' : ids.length ? 'nearest' : 'none',
				products: ids.map((id) => ({ productId: id, name: names.get(id)?.nameFi ?? id })),
				...(res.status === 'unresolved' ? { reason: res.reason } : {})
			});
		} else
			out.push({
				text: ing.text,
				status: ing.catalogue.length ? 'resolved' : 'none',
				products: ing.catalogue
			});
	}
	return out;
}

export interface SupplierLead {
	vendor: string;
	title: string;
	url: string;
	host: string;
	publishedAt: string | null;
	type?: string;
	/** Context.dev's match: the article is mainly about the vendor (`primary`) or mentions it. */
	level?: string;
}

export interface SupplierLeads {
	source: EvidenceSource | 'none';
	vendors: string[];
	leads: SupplierLead[];
	note: string;
}

/** Leads newer than this many days. */
export const LEAD_WINDOW_DAYS = 30;

/** Recent news on each vendor (at most `maxVendors`), newest first. Leads for a person only: never a hold. */
export async function supplierLeads(
	vendors: string[],
	news: NewsSource,
	o: { now?: Date; maxVendors?: number } = {}
): Promise<SupplierLeads> {
	const now = (o.now ?? new Date()).getTime();
	const names = [...new Set(vendors.map((v) => v.trim()).filter((v) => v.length >= 2))].slice(
		0,
		o.maxVendors ?? 5
	);
	if (news.mode === 'fixture' || !names.length)
		return {
			source: 'none',
			vendors: names,
			leads: [],
			note: names.length ? 'Fixture mode: no supplier news is read.' : 'No suppliers on the plan.'
		};
	const leads: SupplierLead[] = [];
	let cached = true;
	let failed = 0;
	for (const vendor of names) {
		let r: Awaited<ReturnType<NewsSource['searchNews']>>;
		try {
			r = await news.searchNews(vendor);
		} catch {
			// An unknown company (404), a cap or a rate limit: no leads for this vendor.
			failed++;
			continue;
		}
		cached &&= r.cached;
		for (const a of r.articles as NewsArticle[]) {
			if (a.published_at && Date.parse(a.published_at) < now - LEAD_WINDOW_DAYS * 86_400_000)
				continue;
			leads.push({
				vendor,
				title: a.title,
				url: a.url,
				host: a.source?.domain ?? host(a.url),
				publishedAt: a.published_at ?? null,
				type: a.type,
				level: a.match?.level
			});
		}
	}
	leads.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
	return {
		source: cached ? 'cache' : 'live',
		vendors: names,
		leads,
		note: `News leads on this plan’s suppliers, for a person to read. A lead never holds a line or changes a plan.${failed ? ` ${failed} supplier(s) could not be searched.` : ''}`
	};
}

/** The Why drawer's evidence for one product, run under the caller's web context (its cache, caps and trace). */
export async function evidenceFor(
	w: import('.').WebRun,
	env: Record<string, string | undefined>,
	input: { productId: string; question?: string }
): Promise<WhyEvidence> {
	const { findingsFor, scopeOf, webClients } = await import('.');
	const { busTrace } = await import('./watch');
	const { lookupFacts } = await import('./lookup');
	const { exa } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
	return factsEvidence(
		await lookupFacts(input, {
			exa,
			catalog: w.ports.catalog,
			findings: findingsFor(env),
			workspaceId: w.ctx.workspaceId
		})
	);
}

/** An outside recipe for an unresolved need, held for sign-off, under the caller's web context. */
export async function makeInHouseFor(
	w: import('.').WebRun,
	env: Record<string, string | undefined>,
	input: { need: string; context?: string }
): Promise<MakeInHouseProposal> {
	const { findingsFor, scopeOf, webClients } = await import('.');
	const { busTrace } = await import('./watch');
	const { exa } = webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey);
	return makeInHouse(input.need, {
		exa,
		catalog: w.ports.catalog,
		findings: findingsFor(env),
		workspaceId: w.ctx.workspaceId,
		...(input.context ? { context: input.context } : {})
	});
}
