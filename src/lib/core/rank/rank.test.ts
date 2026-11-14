import { describe, expect, it } from 'vitest';
import type { Kitchen, Offer, Product } from '../contracts';
import { rankCandidates } from './rank';

const kitchen = {
	weights: { price: 1, reliability: 0, finnish: 0, carbon: 0, organic: 0 },
	mandate: { orderCapCents: 1e9, weeklyCapCents: 1e9, lineCapCents: 1e9 },
	constraints: {
		origin: [],
		allergens: { freeFrom: [], unknownCounts: 'hold' },
		tenderListOnly: false,
		labels: []
	}
} as unknown as Kitchen;
const product = (productId: string) =>
	({
		productId,
		salesUnit: 'ST',
		lotStep: 1,
		packs: [{ unit: 'ST', baseUnits: 1 }],
		allergens: { contains: [], mayContain: [], declared: true },
		labels: []
	}) as unknown as Product;
const offer = (productId: string, cents: number, kind: 'known' | 'unknown') =>
	({
		productId,
		price: { unitCents: cents },
		availability: { kind, amount: null, provenance: { source: 'valio_cache' } }
	}) as unknown as Offer;

describe('D8 supply tier', () => {
	it('ranks confirmed supply above unknown supply, whatever the score', () => {
		const ids = ['cheap-unknown', 'dear-known'];
		const ranked = rankCandidates({
			kitchen,
			candidates: ids.map((productId) => ({ productId, fromValioRule: false, qty: 1 })),
			products: new Map(ids.map((id) => [id, product(id)])),
			offers: new Map([
				['cheap-unknown', offer('cheap-unknown', 100, 'unknown')],
				['dear-known', offer('dear-known', 900, 'known')]
			])
		});
		expect(ranked.map((r) => [r.productId, r.rank, r.supply])).toEqual([
			['dear-known', 1, 'confirmed'],
			['cheap-unknown', 2, 'unknown']
		]);
		// The score still says which is cheaper; only the order is lexicographic.
		expect(ranked[1].score!.total).toBeGreaterThan(ranked[0].score!.total);
	});
});
