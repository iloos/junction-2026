import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import seedJson from '../../../../fixtures/seeds/christmas-buffet-140.json';
import calendar from '../../../../fixtures/seeds/calendar-factors.json';
import { CalendarFactor, EventSeed, factorFor, planEventDemand, roundToSales } from './index';

const seed = EventSeed.parse(seedJson);
const factors = z.array(CalendarFactor).parse(calendar.factors);

describe('planEventDemand on the Christmas buffet seed', () => {
	const { needs, lines } = planEventDemand(seed);

	it('makes one need and one line per dish entry, with stable unique ids', () => {
		expect(needs).toHaveLength(seed.dishes.length);
		expect(lines).toHaveLength(seed.dishes.length);
		expect(new Set(needs.map((n) => n.id)).size).toBe(needs.length);
		expect(needs[0].id).toBe('need:joulukinkku');
		expect(planEventDemand(seed).needs.map((n) => n.id)).toEqual(needs.map((n) => n.id));
		expect(needs[0].provenance).toEqual({
			source: 'team_estimate',
			ref: 'fixtures/seeds/christmas-buffet-140.json'
		});
	});

	for (const d of seed.dishes) {
		it(`reproduces ${d.dish}`, () => {
			const line = lines.find((l) => l.dish === d.dish)!;
			expect(line.productId).toBe(d.productId);
			expect(line.qty.value).toBe(d.order!.qty);
			expect(line.qty.unit).toBe(d.order!.unit);
			expect(line.qty.rounding).toBeTruthy();
			if (d.needL !== undefined) {
				expect(line.needAmount.unit).toBe('l');
				expect(line.needAmount.value).toBeCloseTo(d.needL, 2);
			} else {
				expect(line.needAmount.unit).toBe('kg');
				expect(Math.abs(line.needAmount.value - d.needKg!)).toBeLessThanOrEqual(0.01);
			}
		});
	}

	it('gives milk 10.5 l and 11 ST from 14 kg porridge', () => {
		const milk = lines.find((l) => l.productId === '464201')!;
		expect(milk.needAmount).toEqual({ value: 10.5, unit: 'l' });
		expect(milk.qty).toMatchObject({ value: 11, unit: 'ST' });
	});

	it('rounds herring by drained weight', () => {
		const h = lines.find((l) => l.productId === '463876')!;
		expect(h.needAmount.basis).toBe('drained');
		expect(h.qty.value).toBe(2);
	});

	it('keeps ham at 28 KG after the 120 g edit: the 7 kg lot absorbs it', () => {
		const ham = seed.dishes[0];
		const edited = planEventDemand(seed, { gServedOverrides: { [ham.dish]: 120 } });
		const line = edited.lines.find((l) => l.needId === 'need:joulukinkku')!;
		expect(line.needAmount.value).toBeCloseTo(ham.editCheck!.needKg, 6);
		expect(line.needAmount.value).toBeCloseTo(24.0, 6);
		expect(line.qty).toMatchObject({ value: 28, unit: 'KG' });
		const byId = planEventDemand(seed, { gServedOverrides: { 'need:joulukinkku': 120 } });
		expect(byId.lines[0].qty.value).toBe(28);
	});

	it('scales with guests, and a porridge edit moves rice and milk together', () => {
		const more = planEventDemand(seed, { guests: 200 });
		expect(more.lines.find((l) => l.productId === '462490')!.qty.value).toBe(42);
		const porridge = planEventDemand(seed, {
			gServedOverrides: { 'Riisipuuro (rice porridge): rice': 200 }
		});
		expect(porridge.lines.find((l) => l.productId === '464201')!.qty.value).toBe(21);
		expect(porridge.lines.find((l) => l.productId === '466964')!.qty.value).toBe(4);
	});
});

describe('roundToSales', () => {
	it('gives exactly 8 ST for 5.6 kg / 0.7 kg', () => {
		const q = roundToSales({ value: 5.6, unit: 'kg' }, { salesUnit: 'ST', pack: { netKg: 0.7 } });
		expect(q.value).toBe(8);
		expect(q.rounding).toBe('5.6 kg / 0.7 = 8 ST');
	});

	it('rounds catch-weight kg up to the lot step', () => {
		const q = roundToSales({ value: 11.53, unit: 'kg' }, { salesUnit: 'KG', lotStep: 10 });
		expect(q).toEqual({ value: 20, unit: 'KG', rounding: '11.53 kg → 2 × 10 kg lot = 20 kg' });
	});

	it('rounds pieces against a piece pack', () => {
		const q = roundToSales(
			{ value: 140, unit: 'pcs' },
			{ salesUnit: 'KI', pack: { pieces: 40, netKg: 2.4 } }
		);
		expect(q.value).toBe(4);
	});
});

describe('factorFor', () => {
	it('applies Slush to breakfast at full sensitivity', () => {
		const r = factorFor('2026-11-18', 'breakfastCovers', factors, { event: 1 });
		expect(r.value).toBeCloseTo(1.2, 9);
		expect(r.applied.map((a) => a.id)).toEqual(['slush-2026']);
	});

	it('halves the Slush lift at sensitivity 0.5', () => {
		expect(factorFor('2026-11-18', 'breakfastCovers', factors, { event: 0.5 }).value).toBeCloseTo(
			1.1,
			9
		);
	});

	it('uses the apply window, not the event dates', () => {
		expect(factorFor('2026-11-20', 'breakfastCovers', factors, { event: 1 }).value).toBeCloseTo(
			1.2,
			9
		);
		expect(factorFor('2026-11-21', 'breakfastCovers', factors, { event: 1 }).value).toBe(1);
	});

	it('masks lunch to 0 on Christmas Eve', () => {
		const r = factorFor('2026-12-24', 'lunchCovers', factors, { holiday: 1, month: 1 });
		expect(r.value).toBe(0);
	});

	it('ignores a kind the kitchen is not sensitive to', () => {
		expect(factorFor('2026-12-24', 'lunchCovers', factors, {}).value).toBe(1);
	});

	it('clamps a value above 2 to 2', () => {
		const big = CalendarFactor.parse({
			id: 'x',
			name: 'Big',
			kind: 'event',
			from: '2026-11-01',
			to: '2026-11-30',
			value: 3,
			valueKind: 'estimate',
			appliesTo: ['lunchCovers'],
			source: { name: 'test' }
		});
		expect(factorFor('2026-11-10', 'lunchCovers', [big], { event: 1 }).value).toBe(2);
	});

	it('matches weekdays in UTC', () => {
		// 2026-11-20 is a Friday, 2026-11-23 a Monday.
		expect(factorFor('2026-11-20', 'bistroCovers', factors, { event: 1 }).value).toBeCloseTo(
			1.1,
			9
		);
		expect(factorFor('2026-11-23', 'bistroCovers', factors, { event: 1 }).value).toBe(1);
	});
});
