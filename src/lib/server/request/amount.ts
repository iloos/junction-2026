/**
 * An item without an exact amount, asked once per kind of the reading's shape (D20): unknown ("How many apples?"),
 * as much as is available (the stock Valio states across the shortlist, prefilled, with what the mandate allows), or
 * enough for N people. The answer control's unit comes from the item: litres only for liquids, never for a solid.
 */
import type { Kitchen, Offer, Product } from '$lib/core/contracts';
import { money, num } from '$lib/ui/format';
import { salesUnitWords } from '$lib/ui/request/words';
import type { AnswerSpec } from '$lib/ui/request/types';
import { contentPerSalesUnit } from './convert';
import type { ReqUnit } from './lexicon';
import type { ParsedItem } from './parse';

type Dim = 'l' | 'kg' | 'sales';

/** What one candidate is measured in: litres for a liquid, kg for a weighable solid, else its own sales unit. */
function dimOf(p: Product): Dim {
	if (!('error' in contentPerSalesUnit(p, 'l'))) return 'l';
	if (p.salesUnit === 'KG' || !('error' in contentPerSalesUnit(p, 'kg'))) return 'kg';
	return 'sales';
}

/** The answer units, the item's own first: the shortlist's most common measure. */
export function unitsFor(products: readonly Product[]): ReqUnit[] {
	const n = { l: 0, kg: 0, sales: 0 };
	for (const p of products) n[dimOf(p)]++;
	const first: Dim =
		n.l > n.kg && n.l >= n.sales ? 'l' : n.kg >= n.sales || n.kg > 0 ? 'kg' : 'sales';
	const rest: ReqUnit[] = ['kg', 'pcs', 'sales', 'case'].filter((u) => u !== first) as ReqUnit[];
	return first === 'l' ? ['l', ...rest.filter((u) => u !== 'kg')] : [first, ...rest];
}

/** "How many apples?" for a plural count noun or a pack-sold item, "How much milk?" for a mass. */
export function howMuchWords(query: string, units: readonly ReqUnit[]): string {
	const plural = /[^s]s$/i.test(query.trim()) && !/ss$/i.test(query.trim());
	return `${plural || units[0] === 'sales' ? 'How many' : 'How much'} ${query}?`;
}

interface Cand {
	product: Product;
	offer: Offer | undefined;
}

/**
 * As much as is available: Valio's stated stock across the shortlist, the most one product holds (prefilled), and
 * what the mandate lets the agent order alone at that price.
 */
export function maxAvailable(
	item: Pick<ParsedItem, 'id' | 'query'>,
	cands: readonly Cand[],
	kitchen: Pick<Kitchen, 'mandate'>
): { question: string; answer: AnswerSpec } {
	const units = unitsFor(cands.map((c) => c.product));
	const deliverable = cands.filter(
		(c) =>
			c.offer?.price && !['out', 'undeliverable', 'blocked'].includes(c.offer.availability.kind)
	);
	const stated = deliverable.filter(
		(c) => c.offer!.availability.kind === 'known' && c.offer!.availability.amount !== null
	);
	const unstated = deliverable.length - stated.length;
	if (!stated.length)
		return {
			question: `Valio states no quantity for ${deliverable.length ? `the ${deliverable.length} matching products` : 'any matching product'}, so "as much as available" can't be sized. ${howMuchWords(item.query, units)}`,
			answer: { kind: 'qty', item: item.id, units }
		};
	const physical = (c: Cand, n: number) => {
		const k = contentPerSalesUnit(c.product, 'kg');
		const l = contentPerSalesUnit(c.product, 'l');
		return !('error' in k)
			? { value: n * k.value, unit: 'kg' as const }
			: !('error' in l)
				? { value: n * l.value, unit: 'l' as const }
				: null;
	};
	const sized = stated.map((c) => ({
		c,
		n: c.offer!.availability.amount!,
		ph: physical(c, c.offer!.availability.amount!)
	}));
	const sameUnit = sized.every((s) => s.ph && s.ph.unit === sized[0].ph?.unit);
	const total = sameUnit
		? `${num(
				sized.reduce((s, x) => s + x.ph!.value, 0),
				1
			)} ${sized[0].ph!.unit}`
		: `${sized.length} products' stock`;
	const best = [...sized].sort((a, b) => (b.ph?.value ?? b.n) - (a.ph?.value ?? a.n))[0];
	const unitCents = best.c.offer!.price!.unitCents;
	const cents = unitCents * best.n;
	const cap = kitchen.mandate.lineCapCents;
	const alone = unitCents > 0 ? Math.floor(cap / unitCents) : best.n;
	const capWords =
		cents > cap
			? ` That is ${money(cents, { whole: true })}, over your ${money(cap, { whole: true })} line limit: up to ${salesUnitWords(alone, best.c.product.salesUnit)} alone, the rest needs your sign-off.`
			: ` That is ${money(cents, { whole: true })}, within your line limit.`;
	const prefill = best.ph
		? { qty: +best.ph.value.toFixed(3), unit: best.ph.unit as ReqUnit }
		: { qty: best.n, unit: 'sales' as ReqUnit };
	return {
		question: `Valio states ${total} of ${item.query} across ${sized.length} product${sized.length === 1 ? '' : 's'}${unstated ? `; ${unstated} more don't state a quantity` : ''}. The most from one: ${best.ph ? `${num(best.ph.value, 1)} ${best.ph.unit}` : salesUnitWords(best.n, best.c.product.salesUnit)} of ${best.c.product.nameFi}.${capWords}`,
		answer: {
			kind: 'qty',
			item: item.id,
			units: [prefill.unit, ...units.filter((u) => u !== prefill.unit)],
			prefill,
			productId: best.c.product.productId,
			...(prefill.unit === 'sales' ? { salesUnit: best.c.product.salesUnit } : {}),
			confirm: `Order ${best.ph ? `${num(best.ph.value, 1)} ${best.ph.unit}` : salesUnitWords(best.n, best.c.product.salesUnit)}`
		}
	};
}
