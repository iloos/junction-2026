import { describe, expect, it } from 'vitest';
import type { Offer } from '$lib/core/contracts';
import { cutoffSentence, dayOption, deliveryDays, firstOpenDay, type DayCandidate } from './days';

const conv = {
	ok: true as const,
	salesQty: 1,
	salesUnit: 'ST',
	explain: '',
	exact: true,
	perSalesUnit: null,
	warnings: []
};
function cand(
	id: string,
	model: 'Stock' | 'Terminal',
	closes: string,
	priced = true
): DayCandidate {
	const offer = {
		productId: id,
		price: priced
			? {
					unitCents: 100,
					comparison: null,
					taxRate: 0.14,
					validTo: null,
					provenance: { source: 'valio_cache', at: '2026-12-07T08:00:00Z' }
				}
			: null,
		availability: {
			kind: 'known',
			amount: null,
			logisticModel: model,
			availableDate: '2026-12-09',
			closingTime: closes,
			raw: null,
			provenance: { source: 'valio_cache', at: '2026-12-07T08:00:00Z' }
		}
	} as unknown as Offer;
	return { product: { productId: id, nameFi: id }, offer, conversion: conv };
}

// Mon 7 Dec 14:00 Helsinki.
const NOW = new Date('2026-12-07T14:00:00+02:00');
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

describe('delivery days: the button names the day that results', () => {
	it('Terminal (D-2, 13:30): Wed is closed at 14:00 Mon, earliest is Thu, said with the reason', () => {
		const t = [cand('terminal', 'Terminal', '2026-12-07T13:30:00+02:00')];
		const wed = dayOption([t], '2026-12-09', NOW, ALL_DAYS);
		expect(wed.open).toBe(false);
		expect(wed.reason).toBe("past this product's cut-off (Terminal, 13:30 Mon)");
		const first = firstOpenDay([t], '2026-12-08', NOW, ALL_DAYS);
		expect(first?.date).toBe('2026-12-10');
		expect(cutoffSentence('2026-12-09', wed.reason, first!.date)).toBe(
			"Wed 9 Dec is past this product's cut-off (Terminal, 13:30 Mon): earliest Thu 10 Dec."
		);
	});

	it('a Stock match that cannot be ordered anyway (no price) does not make Wed look open', () => {
		const items = [
			[
				cand('stock-unpriced', 'Stock', '2026-12-08T17:00:00+02:00', false),
				cand('terminal', 'Terminal', '2026-12-07T13:30:00+02:00')
			]
		];
		expect(firstOpenDay(items, '2026-12-08', NOW, ALL_DAYS)?.date).toBe('2026-12-10');
	});

	it('a usable Stock match keeps Wed open (D-1 17:00 Tue)', () => {
		const items = [
			[
				cand('stock', 'Stock', '2026-12-08T17:00:00+02:00'),
				cand('terminal', 'Terminal', '2026-12-07T13:30:00+02:00')
			]
		];
		expect(firstOpenDay(items, '2026-12-08', NOW, ALL_DAYS)?.date).toBe('2026-12-09');
	});

	it('skips a day the kitchen does not receive on, and says why it is not offered', () => {
		const t = [cand('terminal', 'Terminal', '2026-12-07T13:30:00+02:00')];
		const days = deliveryDays([t], '2026-12-07', NOW, ['mon', 'wed', 'fri'], 7);
		expect(days.map((d) => [d.date.slice(8), d.open, d.receiving])).toEqual([
			['07', false, true],
			['08', false, false],
			['09', false, true],
			['10', true, false],
			['11', true, true],
			['12', true, false],
			['13', true, false]
		]);
		expect(days[3].reason).toBe('not one of your delivery days');
		expect(firstOpenDay([t], '2026-12-07', NOW, ['mon', 'wed', 'fri'])?.date).toBe('2026-12-11');
	});

	it('every item must be open: the request takes the later of two items', () => {
		const a = [cand('stock', 'Stock', '2026-12-08T17:00:00+02:00')];
		const b = [cand('terminal', 'Terminal', '2026-12-07T13:30:00+02:00')];
		expect(firstOpenDay([a, b], '2026-12-08', NOW, ALL_DAYS)?.date).toBe('2026-12-10');
	});

	it('with no product known yet, the usual Stock cut-off (D-1 17:00) applies', () => {
		expect(dayOption([], '2026-12-08', NOW, ALL_DAYS).open).toBe(true);
		expect(dayOption([], '2026-12-07', NOW, ALL_DAYS).reason).toBe(
			'past the usual cut-off (Stock, 17:00 Sun)'
		);
	});
});
