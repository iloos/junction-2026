/**
 * One place_order line from a request item and the product picked for it, for every entry that orders: /request,
 * the chat (through /request) and the routine agent. The need it makes keeps the ask as stated (D18) and the item's
 * hard requirements (constraints and diet, D16), so a later substitute, edit or commit is checked against the same
 * rules the first pick was.
 */
import type { Measure, NeedAsk, NeedRequirements, Product } from '$lib/core/contracts';
import { sizeDirect } from '$lib/core/demand';
import { requirementsOf } from './lookup';
import type { ParsedItem } from './parse';

export interface OrderLine {
	productId: string;
	qty: number;
	unit: string;
	amount?: Measure;
	requirements?: NeedRequirements;
	ask?: NeedAsk;
}

/** The request's units in the ask's words: packs and an unstated unit are the product's own sales units. */
const ASK_UNIT: Record<string, NeedAsk['unit']> = {
	kg: 'kg',
	l: 'l',
	pcs: 'pcs',
	case: 'case',
	sales: 'pack'
};

export function orderLineFor(
	item: Pick<ParsedItem, 'text' | 'qty' | 'unit' | 'diet'> & { constraints: readonly string[] },
	pick: {
		productId: string;
		/** The pick's quantity in its sales units, as the conversion read it. */
		salesQty: number;
		salesUnit: string;
		/** What one pick holds when the ask was in packs or cases (the product's stated content), if known. */
		amount?: Measure | null;
	},
	/** The picked product, to size a physical ask exactly; without it the conversion's quantity stands. */
	product?: Product
): OrderLine {
	const base = { productId: pick.productId, qty: pick.salesQty, unit: pick.salesUnit };
	const { qty, unit } = item;
	const requirements = requirementsOf(item.constraints, item.diet);
	// A physical ask (kg, l, pcs) is the need's amount as typed. Packs and cases become one through what the picked
	// product states one sales unit holds (never invented).
	const amount: Measure | null =
		qty === null
			? null
			: unit === 'kg' || unit === 'l' || unit === 'pcs'
				? { value: qty, unit }
				: pick.amount
					? { value: pick.amount.value, unit: pick.amount.unit }
					: null;
	const sized = amount && product ? sizeDirect(product, amount) : null;
	// D18: the ask as stated travels on every line; without a physical size the line makes a sales-kind need that
	// still carries the ask and the requirements.
	const ask: NeedAsk | undefined =
		qty === null || unit === null ? undefined : { words: item.text, qty, unit: ASK_UNIT[unit] };
	const extra = { ...(requirements ? { requirements } : {}), ...(ask ? { ask } : {}) };
	if (amount && sized) return { ...base, qty: sized.value, unit: sized.unit, amount, ...extra };
	if (amount && !product) return { ...base, amount, ...extra };
	return { ...base, ...extra };
}
