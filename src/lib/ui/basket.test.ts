import { describe, expect, it } from 'vitest';
import {
	budgetSentence,
	cannotOrderSentence,
	budgetShares,
	dayAction,
	dayHeadline,
	flatByStage,
	groupBySource,
	sourceChip,
	tokenQty,
	type BasketDay
} from './basket';

const day: BasketDay = {
	date: '2026-12-10',
	sources: [
		{
			planId: 'p-event',
			kind: 'event',
			title: 'Christmas dinner buffet, 140 guests',
			startedBy: 'chef',
			version: 3,
			approvalId: 'ap-1'
		},
		{
			planId: 'p-usual',
			kind: 'usual',
			title: 'Usual order for Thu 10 Dec',
			startedBy: 'chef',
			version: 1,
			approvalId: null
		}
	],
	lines: [
		{
			planId: 'p-event',
			lineId: 'l1',
			productId: '476768',
			productName: 'HK Palvikinkku viipaloitu 1,5 kg',
			qty: { value: 13, unit: 'ST' },
			unitCents: 1543,
			lineCents: 20059,
			stage: 'held',
			reasons: ['new_sku'],
			need: 'Christmas ham',
			substituteFor: 'HK Viljaporsaan juhlakinkku',
			cutoff: '2026-12-08T15:00:00+02:00'
		},
		{
			planId: 'p-event',
			lineId: 'l2',
			productId: '400001',
			productName: 'Lohifilee c-leikattu 10kg',
			qty: { value: 20, unit: 'KG' },
			unitCents: 1411,
			lineCents: 28220,
			stage: 'proposed',
			reasons: [],
			cutoff: '2026-12-09T17:00:00+02:00'
		},
		{
			planId: 'p-usual',
			lineId: 'l3',
			productId: '459000',
			productName: 'Valio laktoositon maito 1 l',
			qty: { value: 120, unit: 'ST' },
			unitCents: 109,
			lineCents: 13080,
			stage: 'ordered',
			reasons: [],
			cutoff: null
		}
	],
	totals: { proposed: 28220, held: 20059, approved: 0, ordered: 13080, all: 61359 },
	budget: { week: '2026-W50', capCents: 400000, orderedCents: 13080, ifAllOrderedCents: 61359 },
	due: '2026-12-08T15:00:00+02:00',
	counts: { orderableNow: 1, waitingOnDecision: 1, decisions: 1, cannotOrder: 0 }
};

describe('basket words', () => {
	it('gives each source a short chip', () => {
		expect(sourceChip(day.sources[0], day.date)).toBe('Christmas dinner buffet');
		expect(sourceChip(day.sources[1], day.date)).toBe('Usual Thursday');
		expect(sourceChip({ ...day.sources[0], kind: 'chat', title: '3 cases Valio milk' })).toBe(
			'3 cases Valio milk'
		);
		expect(
			sourceChip({
				...day.sources[0],
				kind: 'chat',
				title: 'Lactose-free milk for the whole week and extra cream',
				label: 'From chat'
			})
		).toBe('From chat');
		expect(sourceChip({ ...day.sources[0], kind: 'agent', title: 'Weekly dairy' })).toBe(
			'Outside agent'
		);
		expect(sourceChip({ ...day.sources[0], label: 'Event' })).toBe('Christmas dinner buffet');
	});

	it('groups by source, waiting lines first', () => {
		const g = groupBySource(day);
		expect(g.map((x) => x.chip)).toEqual(['Christmas dinner buffet', 'Usual Thursday']);
		expect(g[0].lines.map((l) => l.stage)).toEqual(['held', 'proposed']);
		expect(g[0]).toMatchObject({ cents: 48279, orderable: 1, held: 1 });
	});

	it('flattens by stage with chips', () => {
		expect(flatByStage(day).map((x) => [x.line.stage, x.chip])).toEqual([
			['held', 'Christmas dinner buffet'],
			['proposed', 'Christmas dinner buffet'],
			['ordered', 'Usual Thursday']
		]);
	});

	it('says the day and what to do', () => {
		expect(dayHeadline(day)).toBe('Thu 10 Dec · 3 lines · €613.59');
		expect(dayAction(day)).toBe('1 decision · 1 line can go now, before Tue 8 Dec, 15:00.');
		expect(
			dayAction({ ...day, counts: { ...day.counts, decisions: 0, orderableNow: 0 } })
		).toBeNull();
	});

	it("names what can't be ordered", () => {
		expect(cannotOrderSentence(day)).toBeNull();
		expect(
			cannotOrderSentence({
				...day,
				counts: { ...day.counts, cannotOrder: 2 },
				cannotOrderNames: ['VAASAN JOULUTORTTU 40X60G', 'Lanttulaatikko']
			})
		).toMatch(/^2 can't be ordered for this day: /);
	});

	it('reads the week budget', () => {
		expect(budgetSentence(day)).toBe(
			'€614 of €4,000 this week if all of it is ordered (€131 ordered so far).'
		);
		expect(budgetShares(day)?.ifAll).toBeCloseTo(0.1534, 4);
		expect(budgetSentence({ ...day, budget: { ...day.budget, capCents: null } })).toBeNull();
	});

	it('words quantities for the product token', () => {
		expect(tokenQty({ value: 20, unit: 'KG' })).toEqual({ amount: 20, unit: 'kg' });
		expect(tokenQty({ value: 13, unit: 'ST' }).amount).toBe(13);
	});
});
