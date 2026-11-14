/**
 * Menu ingredient → catalogue product: the candidate pool, and what a kitchen already decided.
 *
 * The resolver is strict about the main ingredient, and the model chooses the words, so the right product is often
 * one the resolver lists as "nearest" or reaches under another spelling. `candidatePool` gathers those, from the query,
 * the model's alternative words and any trade name in the label's brackets, for the chooser (choose.ts) to judge with
 * the dish in view. No word lists here: deciding what an ingredient *is* belongs to the chooser, and diet to core.
 *
 * `rememberPin` / `pinnedFor` keep what a kitchen settled (a chef or agent pin, or a model choice) so the same
 * ingredient gets the same product next time. A chef's or agent's pin is never replaced by a model's choice.
 */
import type { ProductId } from '$lib/core/contracts';
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
interface Pin {
	productId: ProductId;
	by: PinSource;
}

/**
 * By workspace + kitchen + normalised ingredient words. In process for now (one container, D3); a reset workspace
 * starts with none. Persisting it is a port change (Needs).
 */
const pins = new Map<string, Pin>();
const pinKey = (ws: string, kitchenId: string, words: string) =>
	`${ws}|${kitchenId}|${norm(words)}`;

export function rememberPin(
	ws: string,
	kitchenId: string,
	words: string[],
	productId: ProductId,
	by: PinSource
) {
	for (const w of words) {
		if (!w.trim()) continue;
		const k = pinKey(ws, kitchenId, w);
		if (by === 'model' && pins.get(k) && pins.get(k)!.by !== 'model') continue;
		pins.set(k, { productId, by });
	}
}

export function pinnedFor(ws: string, kitchenId: string, words: string[]): Pin | undefined {
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
