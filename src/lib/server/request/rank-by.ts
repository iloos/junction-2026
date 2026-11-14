/**
 * "Rank by" on /request: a per-request preference that re-orders the quoted shortlist with the substitute ranker's
 * weights and utilities (core/rank). It changes which product is picked, never a line's tier or the mandate: the order still goes
 * through place_order, which tiers it as always. Nothing is saved to the kitchen.
 */
import type { Offer, Product } from '$lib/core/contracts';
import type { PriceBasis, RankBy } from '$lib/core/rank/presets';
import { money, num } from '$lib/ui/format';

// The presets and their ordering are core's (core/rank/presets.ts), shared with the chat agent and the tools.
export {
	RANK_BY,
	presetWeights,
	readRankBy,
	priceBasis,
	preferenceOrder,
	type PriceBasis,
	type RankBy
} from '$lib/core/rank/presets';

const LABEL: Record<RankBy, string> = {
	kitchen: 'the kitchen default',
	price: 'price',
	carbon: 'lowest carbon',
	finnish: 'Finnish origin',
	reliability: 'reliability'
};

/** The price difference on a common basis: the total to satisfy the request, else the same comparison unit. */
function priceDelta(
	a: { offer?: Offer; qty?: number },
	b: { offer?: Offer; qty?: number }
): string | null {
	const pa = a.offer?.price;
	const pb = b.offer?.price;
	if (pa && pb && a.qty && b.qty) {
		const d = pa.unitCents * a.qty - pb.unitCents * b.qty;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))} in total`;
	}
	const ca = pa?.comparison;
	const cb = pb?.comparison;
	if (ca && cb && ca.unit === cb.unit) {
		const d = ca.cents - cb.cents;
		return `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}/${ca.unit}`;
	}
	return null;
}

/** "Picked Valio X over Arla Y: −0.9 kg CO₂e/kg, +€0.12/kg", or that the preference kept the default. */
export function preferenceNote(
	by: RankBy,
	chosen: { product: Product; offer?: Offer; qty?: number } | null,
	defaultPick: { product: Product; offer?: Offer; qty?: number } | null,
	basis?: PriceBasis
): string | null {
	if (by === 'kitchen') return null;
	if (by === 'price' && basis === null)
		return 'Ranked by price: no common basis (the packs differ and Valio states no comparison price), so the kitchen default stands.';
	if (!chosen) return null;
	if (!defaultPick || defaultPick.product.productId === chosen.product.productId)
		return `Ranked by ${LABEL[by]}: same pick as the kitchen default, ${chosen.product.nameFi}.`;
	const parts: string[] = [];
	const c1 = chosen.product.co2PerKg?.value;
	const c0 = defaultPick.product.co2PerKg?.value;
	if (c1 !== undefined && c0 !== undefined && c1 !== c0)
		parts.push(`${c1 < c0 ? '−' : '+'}${num(Math.abs(c1 - c0), 1)} kg CO₂e/kg`);
	const p = priceDelta(chosen, defaultPick);
	if (p) parts.push(p);
	if (chosen.product.origin !== defaultPick.product.origin && chosen.product.origin)
		parts.push(`origin ${chosen.product.origin.toUpperCase()}`);
	if (
		chosen.product.reliability !== undefined &&
		defaultPick.product.reliability !== undefined &&
		chosen.product.reliability !== defaultPick.product.reliability
	)
		parts.push(
			`reliability ${num(chosen.product.reliability, 2)} vs ${num(defaultPick.product.reliability, 2)}`
		);
	return `Ranked by ${LABEL[by]}: picked ${chosen.product.nameFi} over ${defaultPick.product.nameFi}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}
