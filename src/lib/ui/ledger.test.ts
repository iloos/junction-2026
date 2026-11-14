import { describe, expect, it } from 'vitest';
import { buildLedger, type ShortageNotice } from './ledger';
import type { BasketDay } from './basket';

const day: BasketDay = {
	date: '2026-12-10',
	sources: [
		{
			planId: 'p-event',
			kind: 'event',
			title: 'Christmas dinner buffet, 140 guests',
			label: 'Event',
			startedBy: 'chef',
			version: 3,
			approvalId: 'ap-1'
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
		}
	],
	totals: { proposed: 28220, held: 20059, approved: 0, ordered: 0, all: 48279 },
	budget: { week: '2026-W50', capCents: 400000, orderedCents: 0, ifAllOrderedCents: 48279 },
	due: '2026-12-08T15:00:00+02:00',
	counts: { orderableNow: 1, waitingOnDecision: 1, decisions: 1, cannotOrder: 0 },
	cannotOrderNames: []
};

const kitchen = (
	kitchenId: string,
	outcome: ShortageNotice['kitchens'][number]['outcome']
): ShortageNotice['kitchens'][number] => ({
	kitchenId,
	kitchenName: kitchenId,
	planId: outcome === 'unaffected' ? null : 'p-event',
	outcome,
	changed: [],
	swaps:
		outcome === 'swapped'
			? [{ fromName: 'LOHIFILEE C-LEIKATTU 10KG', toName: 'KIRJOLOHIFILEE 5KG' }]
			: [],
	allowedBy: 'Its rules: the agent swaps alone up to €800 a line.',
	waitsForPerson: 0,
	why: 'Trout keeps graavilohi covered.'
});

const notice: ShortageNotice = {
	shortageId: 's1',
	productId: '400001',
	productName: 'LOHIFILEE C-LEIKATTU 10KG',
	had: 40,
	left: 10,
	unit: 'kg',
	kitchens: [kitchen('k-other', 'unaffected'), kitchen('k-hotel', 'swapped')]
};

describe('ledger', () => {
	it('puts decisions and ready orders under needs-you, one row each with its value', () => {
		const l = buildLedger([day]);
		expect(l.needsYou.map((e) => [e.kind, e.value])).toEqual([
			['decide', '€200.59'],
			['order', '€282.20']
		]);
		expect(l.needsYou[0].text).toBe('1 line for Christmas dinner buffet waits for your decision');
	});

	it("says what the agent did (replacements, the plan) and what's coming (the delivery)", () => {
		const l = buildLedger([day]);
		expect(l.done.map((e) => e.kind)).toEqual(['swap', 'planned']);
		expect(l.coming[0].text).toBe('Delivery Thu 10 Dec: 2 lines');
	});

	it('reads a shortage notice for this kitchen only, first among what the agent did', () => {
		const l = buildLedger([day], [notice], 'k-hotel');
		expect(l.done[0].kind).toBe('shortage');
		expect(l.done[0].text).toBe(
			'Valio ran short of Lohifilee c-leikattu 10kg (40 → 10 kg): your agent swapped Lohifilee c-leikattu 10kg for Kirjolohifilee 5kg.'
		);
		expect(buildLedger([day], [notice], 'k-other').done[0].kind).toBe('swap');
	});
});
