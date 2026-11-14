import type { Product } from '$lib/core/contracts';
import { rankCandidates } from '$lib/server/request/lookup';
import { baseId, type ParsedItem } from '$lib/server/request/parse';
import { shortText } from './facts';
import type { Intent } from './types';

type RoutineIntent = Extract<Intent, { kind: 'routine_order' }>;

/** Candidates a routine order shows the planner; the rest are counted, not listed. */
export const ROUTINE_SHORTLIST = 5;

export interface RoutineCandidate {
	productId: string;
	name?: string;
	/** The product's sales unit, the unit `place_order` takes. */
	unit: string;
	lotStep?: number;
	origin?: string;
	/** Sales units that hold the asked quantity (rounded up), when the product states its content. */
	salesQty: number | null;
	/** How the quantity was converted, or why it can't be. Our text, from catalogue numbers. */
	conversion: string;
}

export interface RoutineFacts {
	/** Ranked like the request page ranks: lexicon category and name first, then fit. */
	products: RoutineCandidate[];
	/** Search hits ranked out (wrong category, a constraint not met), counted. */
	rejected: number;
	truncated?: { products: number };
	[k: string]: unknown;
}

/** The request parser's item for a routine intent, so ranking and conversion are the request page's own. */
export function routineItem(i: RoutineIntent): ParsedItem {
	const item = {
		text: i.query,
		query: i.query,
		product: i.item.product,
		search: i.item.search,
		qty: i.qty,
		unit: i.unit,
		constraints: i.item.constraints,
		variant: i.item.variant,
		ambiguities: []
	};
	return { ...item, id: baseId(item) };
}

/**
 * Search hits for a routine order → ranked candidates with the asked quantity in each one's sales units
 * (`convert` from the request parser). A product whose content is unknown keeps `salesQty: null` and the
 * reason, so nothing downstream falls back to "N sales units".
 */
export function routineCandidates(intent: RoutineIntent, hits: Product[]): RoutineFacts {
	const { ranked, rejected } = rankCandidates(routineItem(intent), hits);
	const out: RoutineFacts = {
		products: ranked.slice(0, ROUTINE_SHORTLIST).map((r) => ({
			productId: r.product.productId,
			name: shortText(r.product.nameShort?.value ?? r.product.nameFi),
			unit: r.product.salesUnit,
			lotStep: r.product.lotStep,
			origin: r.product.origin ?? undefined,
			salesQty: r.conversion?.ok ? r.conversion.salesQty : null,
			conversion:
				shortText(
					r.conversion
						? r.conversion.ok
							? r.conversion.explain
							: `can't convert: ${r.conversion.reason}`
						: 'no quantity',
					160
				) ?? ''
		})),
		rejected: rejected.length
	};
	if (ranked.length > ROUTINE_SHORTLIST) out.truncated = { products: ranked.length };
	return out;
}
