import { describe, expect, it } from 'vitest';
import { STEERS, pickWords, swapRows, withAlternatives, type Candidate } from './swap';

const c = (id: string, rank: number | null, extra: Partial<Candidate> = {}): Candidate => ({
	productId: id,
	productName: `P${id}`,
	rank,
	rejectedReasons: [],
	fromValioRule: false,
	...extra
});

describe('swap panel rows', () => {
	it("puts the agent's pick first, skips the current product, refused ones last with the rule named", () => {
		const rows = swapRows(
			[
				c('9', 3),
				c('1', 1, { whatChanges: 'sliced, 1.5 kg packs' }),
				c('cur', 2),
				c('5', null, { rejectedReasons: ['allergen_unknown'] }),
				c('7', 2, { fromValioRule: true })
			],
			'cur'
		);
		expect(rows.map((r) => r.productId)).toEqual(['1', '7', '9', '5']);
		expect(rows[0]).toMatchObject({ pick: true, reason: 'sliced, 1.5 kg packs' });
		expect(rows[1].reason).toBe("Valio's own substitute");
		expect(rows[3].refused).toBe('Allergens differ');
		expect(pickWords(rows[0])).toBe("Agent's pick");
		expect(pickWords(rows[1])).toBe('Your choice');
	});

	it('caps at the pick plus four alternatives', () => {
		const rows = swapRows(
			Array.from({ length: 9 }, (_, i) => c(String(i), i + 1)),
			'none'
		);
		expect(rows).toHaveLength(5);
	});

	it('has the D28 steers: three rank, five steer', () => {
		expect(STEERS.filter((s) => s.rankBy).map((s) => s.label)).toEqual([
			'Cheaper',
			'Finnish',
			'In stock'
		]);
		expect(STEERS.filter((s) => s.steer)).toHaveLength(5);
	});

	it('puts each alternative total for the need and its unit price on the row', () => {
		const rows = withAlternatives(
			swapRows([c('1', 1)], 'cur'),
			[
				{
					productId: '1',
					reason: 'Finnish, in stock',
					supply: 'known_stock',
					pricePer: { cents: 301, per: 'kg' },
					qty: { value: 4, unit: 'cases' },
					totalCents: 5210
				},
				{ productId: '2', productName: 'P2', reason: 'Organic', supply: 'unknown_stock' }
			],
			'cur'
		);
		expect(rows[0]).toMatchObject({
			reason: 'Finnish, in stock',
			total: { cents: 5210, qty: { value: 4, unit: 'cases' } },
			per: { cents: 301, per: 'kg' }
		});
		expect(rows[1]).toMatchObject({ productId: '2', reason: 'Organic', pick: false });
	});
});
