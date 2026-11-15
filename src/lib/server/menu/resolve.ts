/**
 * Menu ingredient → catalogue product: the candidate pool, and what a kitchen already decided.
 *
 * The resolver is strict about the main ingredient, and the model chooses the words, so the right product is often
 * one the resolver lists as "nearest" or reaches under another spelling. `candidatePool` gathers those, from the query,
 * the model's alternative words and any trade name in the label's brackets, for the chooser (choose.ts) to judge with
 * the dish in view. No word lists here: deciding what an ingredient *is* belongs to the chooser, and diet to core.
 *
 * `kitchenPins` / `pinnedFor` read what a kitchen settled (a chef's or agent's pin, or a model's pick, marked
 * `pinnedBy` on the ingredient) from its recent menus, so the same ingredient gets the same product next time.
 */
import type { DishIngredient, MenuProposal, ProductId } from '$lib/core/contracts';
import type { Resolution } from '$lib/core/ports';

/** Words tried per ingredient (each a local, in-memory search). */
export const MAX_VARIANTS = 4;
/** Candidates the chooser sees per ingredient. */
export const POOL_SIZE = 10;

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** "Porsaan kylkirivi (ribs)" → ["ribs"]: a trade name in the label's brackets. */
function bracketed(label: string): string[] {
	return [...label.matchAll(/\(([^)]{2,40})\)/g)]
		.map((m) => norm(m[1]))
		.filter((s) => !/\d/.test(s));
}

/** The words to try, in order, without repeats: the query, the model's alternatives, a bracketed trade name. */
export function queryVariants(query: string, alt: string[] = [], label = ''): string[] {
	const out: string[] = [];
	for (const v of [query, ...alt, ...bracketed(label)].map(norm))
		if (v && !out.includes(v)) out.push(v);
	return out.slice(0, MAX_VARIANTS);
}

/**
 * Candidates for one ingredient, best first: each variant's resolved products, then the resolver's nearest (the right
 * product is often there when the words differ), without repeats. `resolveOne` applies the diet the brief enforces.
 */
export async function candidatePool(
	resolveOne: (q: string) => Promise<Resolution | null>,
	o: { query: string; alt?: string[]; label: string }
): Promise<ProductId[]> {
	const out: ProductId[] = [];
	const add = (id: ProductId) => {
		if (!out.includes(id)) out.push(id);
	};
	const answers = await Promise.all(queryVariants(o.query, o.alt, o.label).map(resolveOne));
	for (const r of answers)
		if (r?.status === 'resolved') r.candidates.forEach((c) => add(c.productId));
	for (const r of answers)
		if (r?.status === 'unresolved')
			r.nearest.forEach((n) => n.failed === 'match' && add(n.productId));
	return out.slice(0, POOL_SIZE);
}

/* ── What a kitchen settled ───────────────────────────────────────────────── */

export type PinSource = 'chef' | 'agent' | 'model';
export interface Pin {
	productId: ProductId;
	by: PinSource;
}
/** Normalised ingredient words → the settled product, or null where a chef turned the product down. */
export type KitchenPins = Map<string, Pin | null>;

/** How many of the kitchen's recent menus its settled products are read from. */
export const RECENT_MENUS = 20;

const isPerson = (by: PinSource | undefined) => by === 'chef' || by === 'agent';

/**
 * What a kitchen settled, read from its recent menus (newest first; `MenuStore.recent`). A chef's or agent's pin wins
 * over a model's pick whatever their age; among equals the newest wins; a product a chef turned down (dropped back to
 * unresolved) stops either from being reused. A model's pick counts only from a menu a chef reviewed: an unreviewed
 * pick is a guess, not the kitchen's choice. Keys are the ingredient's search words and its label. Every pin is still
 * checked against the new menu's requirements before use (proposal.ts usablePin).
 */
export function kitchenPins(menus: MenuProposal[]): KitchenPins {
	const out: KitchenPins = new Map();
	const keys = (i: DishIngredient) =>
		[i.provenance.ref ?? '', i.label].map(norm).filter((k) => k.length > 0);
	const ings = menus.flatMap((m) => m.dishes.flatMap((d) => d.ingredients));
	for (const i of ings) {
		const turnedDown = !i.productId && i.unresolved !== undefined && i.provenance.source === 'user';
		const value =
			i.productId && isPerson(i.pinnedBy) ? { productId: i.productId, by: i.pinnedBy! } : null;
		if (!value && !turnedDown) continue;
		for (const k of keys(i)) if (!out.has(k)) out.set(k, value);
	}
	const reviewed = menus
		.filter((m) => m.review)
		.flatMap((m) => m.dishes.flatMap((d) => d.ingredients));
	for (const i of reviewed)
		if (i.productId && i.pinnedBy === 'model')
			for (const k of keys(i)) if (!out.has(k)) out.set(k, { productId: i.productId, by: 'model' });
	return out;
}

/** The settled product for an ingredient's words; undefined when none, or when a chef turned it down. */
export function pinnedFor(pins: KitchenPins, words: string[]): Pin | undefined {
	for (const w of words.map(norm)) {
		if (!pins.has(w)) continue;
		return pins.get(w) ?? undefined;
	}
	return undefined;
}
