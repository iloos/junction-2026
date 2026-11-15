/**
 * The compare panel behind every line's "Swap" (D28): the agent's pick and up to four alternatives, one reason each,
 * and steer chips that re-run the search. Pure: the panel calls the tools, this decides what the rows say.
 */
import type { RankBy } from '$lib/core/contracts/tools';
import { reasonShort } from './reasons';

/** find_substitutes' steer (D28): the chef narrows or widens the alternatives for one call. */
export interface SteerInput {
	organic?: boolean;
	pack?: 'bigger' | 'smaller';
	sameBrand?: boolean;
	differentKind?: boolean;
	text?: string;
}

/** A steer chip: a ranking preference (rankBy) or a steer. */
export interface Steer {
	id: string;
	label: string;
	rankBy?: RankBy;
	steer?: SteerInput;
}

export const STEERS: Steer[] = [
	{ id: 'cheaper', label: 'Cheaper', rankBy: 'price' },
	{ id: 'finnish', label: 'Finnish', rankBy: 'finnish' },
	{ id: 'in_stock', label: 'In stock', rankBy: 'reliability' },
	{ id: 'organic', label: 'Organic', steer: { organic: true } },
	{ id: 'bigger', label: 'Bigger pack', steer: { pack: 'bigger' } },
	{ id: 'smaller', label: 'Smaller pack', steer: { pack: 'smaller' } },
	{ id: 'same_brand', label: 'Same brand', steer: { sameBrand: true } },
	{ id: 'other_kind', label: 'Different kind', steer: { differentKind: true } }
];

export interface Candidate {
	productId: string;
	productName?: string;
	/** The catalogue's English name, when it has one. */
	productNameEn?: string;
	rank: number | null;
	rejectedReasons: string[];
	caution?: string;
	whatChanges?: string;
	fromValioRule: boolean;
	bestTry?: { relaxes: 'origin' | 'labels' };
}

/** find_substitutes' alternatives (D28): sized to the need, with its total and its price per kg or l. */
export interface Alternative {
	productId: string;
	productName?: string;
	productNameEn?: string;
	reason: string;
	supply: string;
	pricePer?: { cents: number; per: string };
	qty?: { value: number; unit: string };
	totalCents?: number;
}

export interface SwapRow {
	productId: string;
	name: string;
	/** The product in English, a muted second line. */
	en?: string;
	/** What it costs for the need, sized ("€52.10 · 4 cases"), when the search sized it. */
	total?: { cents: number; qty?: { value: number; unit: string } };
	/** Price per kg, l or piece, when the pack content is known. */
	per?: { cents: number; per: string };
	/** One reason, in words. */
	reason: string;
	/** The agent would pick this one. */
	pick: boolean;
	/** A hard rule refuses it: shown, named, not pickable. */
	refused: string | null;
}

/** The pick first, then up to `n` alternatives the rules allow, then refused ones (named) to fill. */
export function swapRows(cands: readonly Candidate[], currentId: string, n = 4): SwapRow[] {
	const rows = cands
		.filter((c) => c.productId !== currentId)
		.map((c) => {
			const hard = c.rejectedReasons.filter((r) => !r.startsWith('CAUTION.'));
			return {
				productId: c.productId,
				name: c.productName ?? c.productId,
				...(c.productNameEn ? { en: c.productNameEn } : {}),
				reason:
					c.whatChanges ??
					c.caution ??
					(c.bestTry ? `Nearest match: breaks the ${c.bestTry.relaxes} rule only` : ''),
				pick: false,
				refused: hard.length ? hard.map(reasonShort).join(', ') : null,
				rank: c.rank ?? Number.MAX_SAFE_INTEGER,
				valio: c.fromValioRule
			};
		})
		.sort((a, b) => Number(!!a.refused) - Number(!!b.refused) || a.rank - b.rank);
	return rows.slice(0, n + 1).map((r, i) => ({
		productId: r.productId,
		name: r.name,
		refused: r.refused,
		pick: i === 0 && !r.refused,
		reason: r.reason || (r.valio ? "Valio's own substitute" : 'Matches the need')
	}));
}

/** What picking says on the row: the agent's pick, or the chef's own choice. */
export function pickWords(row: SwapRow): string {
	return row.pick ? "Agent's pick" : 'Your choice';
}

/**
 * The alternatives' own reasons, totals and unit prices on the rows (sized to the need by the search); rows the
 * search didn't size keep theirs. Alternatives not among the ranked candidates join after them.
 */
export function withAlternatives(
	rows: readonly SwapRow[],
	alts: readonly Alternative[] | undefined,
	currentId: string
): SwapRow[] {
	if (!alts?.length) return [...rows];
	const by = new Map(alts.map((a) => [a.productId, a]));
	const out = rows.map((r) => {
		const a = by.get(r.productId);
		return a
			? {
					...r,
					name: a.productName ?? r.name,
					...(a.productNameEn ? { en: a.productNameEn } : {}),
					reason: a.reason || r.reason,
					...(a.totalCents != null ? { total: { cents: a.totalCents, qty: a.qty } } : {}),
					...(a.pricePer ? { per: a.pricePer } : {})
				}
			: r;
	});
	for (const a of alts)
		if (a.productId !== currentId && !out.some((r) => r.productId === a.productId))
			out.push({
				productId: a.productId,
				name: a.productName ?? a.productId,
				...(a.productNameEn ? { en: a.productNameEn } : {}),
				reason: a.reason,
				pick: false,
				refused: null,
				...(a.totalCents != null ? { total: { cents: a.totalCents, qty: a.qty } } : {}),
				...(a.pricePer ? { per: a.pricePer } : {})
			});
	return out;
}
