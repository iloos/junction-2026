/**
 * Web facts for lines with no allergen record ("?"), looked up ahead so the evidence is ready when the chef opens the
 * line: the same Exa facts lookup the Why drawer runs (web/lookup.ts `lookupFacts`), in the background when a plan is
 * created or re-priced, within the prefetch caps. It files a finding for the plan's workspace and changes nothing
 * else: a web fact never clears a hold, never answers a requirement and never reaches `meets()` (D6).
 *
 * `webFactsFor` reads what is already known (the warm-up's findings, an EAN-verified product page's facts) for the
 * kitchen to show as evidence on the line ("Web: contains milk · s-kaupat.fi"). Never a call.
 */
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { findingsFor, webClients } from '../web';
import type { Suggestion } from '../web/lookup';
import { PREFETCH_LIMITS } from './photos';

type Env = Record<string, string | undefined>;

/** What the web says about a product's allergens, with where it says it. */
export interface WebAllergenFacts {
	contains: string[];
	mayContain: string[];
	/** Where it was read: host and page; `eanVerified` when the page's barcode equals the product's GTIN. */
	source: { host: string; url: string; eanVerified: boolean };
	/** Always evidence for a person: never clears a hold or answers a requirement. */
	evidence: true;
}

const hostOf = (u: string) => {
	try {
		return new URL(u).host.replace(/^www\./, '');
	} catch {
		return u;
	}
};
const list = (v: unknown) =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];

/** Allergen facts from a finding's suggestions, the strongest source first (an EAN-cited page). */
export function allergenFactsOf(
	suggestions: readonly Suggestion[],
	eanVerified = false
): WebAllergenFacts | null {
	const pick = (field: 'allergens' | 'mayContain') => suggestions.find((s) => s.field === field);
	const a = pick('allergens');
	const m = pick('mayContain');
	const contains = list(a?.value);
	const may = list(m?.value);
	if (!contains.length && !may.length) return null;
	const src = (a ?? m)!.sources.find((s) => s.gtinCited) ?? (a ?? m)!.sources[0];
	if (!src) return null;
	return {
		contains,
		mayContain: may,
		source: { host: hostOf(src.url), url: src.url, eanVerified: eanVerified || !!src.gtinCited },
		evidence: true
	};
}

/** Known web allergen facts per product for a workspace: its own lookups, then EAN-verified product pages. Never a call. */
export function webFactsFor(
	env: Env,
	workspaceId: string,
	productIds: readonly string[]
): Record<string, WebAllergenFacts> {
	const findings = findingsFor(env);
	const out: Record<string, WebAllergenFacts> = {};
	for (const id of productIds) {
		const page = findings.get(`facts:${id}:page`)?.data as
			{ suggestions?: Suggestion[] } | undefined;
		const own = findings.get(`${workspaceId}:facts:${id}`)?.data as
			{ suggestions?: Suggestion[] } | undefined;
		const f =
			(page?.suggestions && allergenFactsOf(page.suggestions, true)) ??
			(own?.suggestions && allergenFactsOf(own.suggestions)) ??
			null;
		if (f) out[id] = f;
	}
	return out;
}

/** Products already looked up in this process, per workspace, so a re-plan doesn't repeat them. */
const done = new Set<string>();
const DONE_CAP = 4000;

/**
 * Look up web facts for the products with no allergen record, one at a time, within the prefetch caps (key
 * `prefetch:<ws>`). No-op in fixture mode (the fixture search answers from recordings). Returns how many were asked.
 */
export async function warmAllergenFacts(
	env: Env,
	workspaceId: string,
	catalog: Catalog,
	products: readonly Product[],
	max = 8
): Promise<number> {
	const todo = products.filter(
		(p) => !p.allergens.declared && !done.has(`${workspaceId}:${p.productId}`)
	);
	if (!todo.length) return 0;
	const { lookupFacts } = await import('../web/lookup');
	const { exa } = webClients(env, undefined, `prefetch:${workspaceId}`, PREFETCH_LIMITS);
	if (exa.mode !== 'live') return 0;
	const findings = findingsFor(env);
	let n = 0;
	for (const p of todo) {
		if (n >= max || done.size >= DONE_CAP) break;
		done.add(`${workspaceId}:${p.productId}`);
		n += 1;
		await lookupFacts({ productId: p.productId }, { exa, catalog, findings, workspaceId }).catch(
			() => null
		);
	}
	return n;
}
