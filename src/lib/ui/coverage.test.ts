import { describe, expect, it } from 'vitest';
import type { FulfilmentView } from '$lib/core/contracts';
import {
	coverageHeadline,
	coverageSentence,
	lineBasis,
	needStatus,
	needTally,
	segments
} from './coverage';
import rescued from '../../../fixtures/views/christmas-rescued.json';

const kg = (value: number) => ({ value, unit: 'kg' as const });
const f = (o: Partial<FulfilmentView>): FulfilmentView => ({
	needId: 'n',
	label: 'x',
	required: kg(10),
	supplierConfirmed: kg(0),
	awaitingSupplier: kg(0),
	plannedKnown: kg(0),
	plannedUnknown: kg(0),
	unresolved: kg(0),
	excess: kg(0),
	status: 'planned',
	allocations: [],
	...o
});

describe('coverage copy (D10 vocabulary)', () => {
	it('never calls planned stock confirmed, and names the weakest certainty first', () => {
		const v = f({ plannedKnown: kg(6), plannedUnknown: kg(4), excess: kg(2) });
		expect(coverageHeadline(v)).toEqual({
			text: '4 kg on unknown stock · +2 kg over',
			tone: 'plannedUnknown'
		});
		const s = coverageSentence(v);
		expect(s).toBe(
			'Need 10 kg: 6 kg planned against known stock, 4 kg planned with unknown stock. Packs add 2 kg over the need.'
		);
		expect(s).not.toMatch(/confirmed/);
	});

	it('draws the partition up to the needed mark and excess past it', () => {
		const { parts, requiredAt } = segments(
			f({ plannedKnown: kg(7), unresolved: kg(3), excess: kg(2) })
		);
		expect(parts.map((p) => p.key)).toEqual(['plannedKnown', 'unresolved', 'excess']);
		expect(requiredAt).toBeCloseTo(10 / 12);
		expect(parts.reduce((a, p) => a + p.width, 0)).toBeCloseTo(1);
	});

	it('the partition in the core fixture sums to required for every need', () => {
		for (const v of (rescued as unknown as { view: { fulfilment: FulfilmentView[] } }).view
			.fulfilment) {
			const sum =
				v.supplierConfirmed.value +
				v.awaitingSupplier.value +
				v.plannedKnown.value +
				v.plannedUnknown.value +
				v.unresolved.value;
			expect(sum).toBeCloseTo(v.required.value, 3);
		}
	});
});

describe('line basis (F14)', () => {
	it('shows what the sales units are physically and both prices', () => {
		expect(
			lineBasis(
				{ value: 13, unit: 'ST' },
				{
					physical: { value: 19.5, unit: 'kg', basis: 'net' },
					unitPrice: { cents: 1543, per: 'ST' },
					comparisonPrice: { cents: 1029, per: 'kg' }
				}
			)
		).toEqual({
			buys: '13 ST',
			physical: '≈ 19.5 kg net',
			unitPrice: '€15.43/ST',
			comparison: '€10.29/kg'
		});
	});

	it('does not repeat a KG line as kg, and never guesses a weight', () => {
		const kgLine = lineBasis(
			{ value: 20, unit: 'KG' },
			{
				physical: { value: 20, unit: 'kg', basis: 'net' },
				unitPrice: { cents: 1411, per: 'KG' },
				comparisonPrice: { cents: 1411, per: 'kg' }
			}
		);
		expect(kgLine.physical).toBeNull();
		expect(kgLine.comparison).toBeNull();
		expect(lineBasis({ value: 2, unit: 'KI' }, undefined)).toEqual({
			buys: '2 KI',
			physical: null,
			unitPrice: null,
			comparison: null
		});
	});
});

describe('need tally', () => {
	it('rates each need by its least certain cover', () => {
		const fs = (rescued as unknown as { view: { fulfilment: FulfilmentView[] } }).view.fulfilment;
		const t = needTally(fs);
		expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(fs.length);
		for (const f of fs)
			if (f.unresolved.value > 0) expect(needStatus(f)).toBe('unresolved');
			else if (f.plannedUnknown.value > 0) expect(needStatus(f)).toBe('plannedUnknown');
	});

	it('keeps ordered-awaiting apart from planned stock (D10)', () => {
		expect(needStatus(f({ awaitingSupplier: kg(4), supplierConfirmed: kg(6) }))).toBe(
			'awaitingSupplier'
		);
		expect(needStatus(f({ plannedKnown: kg(4), awaitingSupplier: kg(6) }))).toBe('plannedKnown');
		expect(needStatus(f({ supplierConfirmed: kg(10) }))).toBe('supplierConfirmed');
	});
});
