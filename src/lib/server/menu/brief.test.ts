import { describe, expect, it } from 'vitest';
import {
	applyBriefAnswers,
	dietaryIn,
	draftBrief,
	missing,
	nextQuestion,
	readBriefAnswers,
	toEventBrief
} from './brief';

const TODAY = '2026-12-07'; // Monday, the sim clock
const XMAS = 'Christmas dinner for 50 on 20 December';
const STAR = '5-star 5-course dinner for 50';

describe('brief from the words', () => {
	it('golden brief: Christmas dinner for 50 on 20 December', () => {
		const d = draftBrief(XMAS, TODAY);
		expect(d).toMatchObject({ guests: 50, date: '2026-12-20', serviceStyle: null, dietary: null });
		expect(d.title).toBe('Christmas dinner for 50 on 20 December');
		expect(missing(d)).toEqual(['serviceStyle', 'dietary', 'budget']);
	});

	it('golden brief: 5-star 5-course dinner for 50', () => {
		const d = draftBrief(STAR, TODAY);
		expect(d).toMatchObject({ guests: 50, courses: 5, serviceStyle: 'plated', date: null });
		expect(d.notes).toContain('fine-dining level asked');
		expect(missing(d)).toEqual(['date', 'dietary', 'budget']);
	});

	it('reads requirements, counts and budgets from the words', () => {
		expect(dietaryIn('lactose-free, 6 vegetarians and one vegan')).toEqual([
			'lactose-free',
			'vegetarian:6',
			'vegan'
		]);
		const d = draftBrief('buffet for 80 on Friday, €40 per guest, gluten-free', TODAY);
		expect(d).toMatchObject({
			guests: 80,
			serviceStyle: 'buffet',
			budgetCents: 320000,
			dietary: ['gluten-free'],
			date: '2026-12-11'
		});
		expect(missing(d)).toEqual([]);
	});
});

describe('one question at a time, keyed by id', () => {
	it('asks only what is missing, in order, and finishes with a valid EventBrief', () => {
		let d = draftBrief(XMAS, TODAY);
		const q1 = nextQuestion(d, TODAY)!;
		expect(q1).toMatchObject({ id: 'brief.serviceStyle', field: 'serviceStyle' });
		expect(q1.chips.map((c) => c.answer.value)).toContain('plated');

		d = applyBriefAnswers(d, [{ id: 'brief.serviceStyle', value: 'plated' }], TODAY);
		expect(nextQuestion(d, TODAY)?.id).toBe('brief.courses');
		d = applyBriefAnswers(d, [{ id: 'brief.courses', value: 3 }], TODAY);
		const qd = nextQuestion(d, TODAY)!;
		expect(qd).toMatchObject({ id: 'brief.dietary', multi: true });
		d = applyBriefAnswers(d, [{ id: 'brief.dietary', value: ['lactose-free'] }], TODAY);
		const qb = nextQuestion(d, TODAY)!;
		expect(qb.id).toBe('brief.budget');
		expect(qb.chips.map((c) => c.label)).toContain('€40 per guest (€2000)');
		d = applyBriefAnswers(d, [{ id: 'brief.budget', value: 0 }], TODAY);
		expect(nextQuestion(d, TODAY)).toBeNull();

		const brief = toEventBrief(d, XMAS)!;
		expect(brief).toMatchObject({
			title: 'Christmas dinner for 50 on 20 December',
			date: '2026-12-20',
			guests: 50,
			serviceStyle: 'plated',
			courses: 3,
			dietary: ['lactose-free']
		});
		expect(brief.budgetCents).toBeUndefined();
		expect(brief.provenance.note).toMatch(/from the words: guests, date; answered by the chef/);
	});

	it('answers apply by id in any order; a buffet needs no course count', () => {
		const d = applyBriefAnswers(
			draftBrief(XMAS, TODAY),
			[
				{ id: 'brief.budget', value: 1500 },
				{ id: 'brief.dietary', value: [] },
				{ id: 'brief.serviceStyle', value: 'buffet' }
			],
			TODAY
		);
		expect(missing(d)).toEqual([]);
		expect(toEventBrief(d, XMAS)).toMatchObject({ budgetCents: 150000, dietary: [] });
	});

	it('an answer never removes a typed requirement', () => {
		const d = applyBriefAnswers(
			draftBrief('lactose-free Christmas buffet for 40 on 20 December', TODAY),
			[{ id: 'brief.dietary', value: ['vegan'] }],
			TODAY
		);
		expect(d.dietary).toEqual(['lactose-free', 'vegan']);
	});

	it('ignores malformed answers and keeps the question open', () => {
		const d = applyBriefAnswers(
			draftBrief(STAR, TODAY),
			[
				{ id: 'brief.date', value: '2026-02-30' },
				{ id: 'brief.date', value: '2026-12-01' },
				{ id: 'brief.guests', value: 50000 }
			],
			TODAY
		);
		expect(d.date).toBeNull();
		expect(d.guests).toBe(50);
		expect(nextQuestion(d, TODAY)?.id).toBe('brief.date');
		expect(
			readBriefAnswers([
				{ id: 'brief.date', value: '2026-12-20' },
				{ id: 'brief.nope', value: 1 },
				{ id: 'brief.dietary', value: [1] },
				'x'
			])
		).toEqual([{ id: 'brief.date', value: '2026-12-20' }]);
	});
});

describe('counted request constraints', () => {
	it('keeps the head count of a lactose-free requirement', () => {
		expect(
			dietaryIn('Christmas dinner for 50 on 20 December, 4 lactose-free and 2 vegetarians')
		).toEqual(['lactose-free:4', 'vegetarian:2']);
		expect(dietaryIn('dinner for 40, 3 lactose free')).toEqual(['lactose-free:3']);
		expect(dietaryIn('lactose-free dinner for 40')).toEqual(['lactose-free']);
	});
});

describe('brief title', () => {
	it('keeps the date words and closes the gap before a comma', () => {
		const d = draftBrief('Christmas dinner for 50 on Saturday 12 December, buffet', '2026-12-07');
		expect(d.title).toBe('Christmas dinner for 50 on Saturday 12 December, buffet');
	});
});

describe('moment 2: the words of a menu ask', () => {
	const today = '2026-12-07';
	it('"a no-meat dinner for 120 with a peach dessert" is vegetarian for 120', () => {
		const d = draftBrief('a no-meat dinner for 120 with a peach dessert', today);
		expect(d).toMatchObject({ guests: 120, dietary: ['vegetarian'] });
	});
	it('a typed answer that is not a diet leaves the dietary question open', () => {
		const d = draftBrief('dinner for 40 on Saturday, buffet', today);
		expect(
			applyBriefAnswers(d, [{ id: 'brief.dietary', value: 'no budget' }], today).dietary
		).toBeNull();
		expect(applyBriefAnswers(d, [{ id: 'brief.dietary', value: 'none' }], today).dietary).toEqual(
			[]
		);
		expect(
			applyBriefAnswers(d, [{ id: 'brief.dietary', value: 'gluten free please' }], today).dietary
		).toEqual(['gluten-free']);
	});
	it('the day chips say the day in words', () => {
		const q = nextQuestion(draftBrief('dinner for 40', today), today)!;
		expect(q.field).toBe('date');
		expect(q.chips.map((c) => c.label)).toEqual(['Fri 11 Dec', 'Sat 12 Dec']);
	});
});
