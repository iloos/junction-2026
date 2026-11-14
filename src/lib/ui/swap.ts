/**
 * The compare panel behind every line's "Swap" (D28): the agent's pick and up to four alternatives, one reason each,
 * and steer chips that re-run the search. Pure: the panel calls the tools, this decides what the rows say.
 */
import type { RankBy } from '$lib/core/contracts/tools';
import { reasonShort } from './reasons';

/** A steer chip. `rankBy` runs today; `steer` waits for find_substitutes' steer parameter (S1). */
export interface Steer {
	id: string;
	label: string;
	rankBy?: RankBy;
	steer?: string;
}

export const STEERS: Steer[] = [
	{ id: 'cheaper', label: 'Cheaper', rankBy: 'price' },
	{ id: 'finnish', label: 'Finnish', rankBy: 'finnish' },
	{ id: 'in_stock', label: 'In stock', rankBy: 'reliability' },
	{ id: 'organic', label: 'Organic', steer: 'organic' },
	{ id: 'bigger', label: 'Bigger pack', steer: 'bigger_pack' },
	{ id: 'smaller', label: 'Smaller pack', steer: 'smaller_pack' },
	{ id: 'same_brand', label: 'Same brand', steer: 'same_brand' },
	{ id: 'other_kind', label: 'Different kind', steer: 'different_kind' }
];

export interface Candidate {
	productId: string;
	productName?: string;
	rank: number | null;
	rejectedReasons: string[];
	caution?: string;
	whatChanges?: string;
	fromValioRule: boolean;
	bestTry?: { relaxes: 'origin' | 'labels' };
}

export interface SwapRow {
	productId: string;
	name: string;
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
