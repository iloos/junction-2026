import { describe, expect, it } from 'vitest';
import type { Plan } from '$lib/core/contracts';
import { classifyGoal } from './classify';
import { SUPPORTED_EVENTS } from './context';
import { resolveIntent } from './intent';
import { nextActionFor } from './next-action';
import type { AgentContext } from './types';

const TODAY = '2026-11-14';

describe('one classifier for request and agent (review §ranked 2)', () => {
	it.each([
		['20 kg salmon for the Christmas dinner', 'order'],
		['4 kg butter for dinner tomorrow', 'order'],
		['Order 3 packs kerma for tomorrow', 'order'],
		['Christmas dinner for 50 on 20 December', 'event'],
		['Pikkujoulut 60 hengelle 18.12.', 'event'],
		['Wedding dinner for 80 guests, 3 courses', 'event'],
		['What needs my approval?', 'read'],
		['show the budget', 'read'],
		['How much does butter cost?', 'read'],
		['Is 4 kg butter available tomorrow?', 'read'],
		['Mitkä rivit odottavat hyväksyntää?', 'read'],
		['approve it', 'authority'],
		['approve everything that is held', 'authority'],
		['Can you approve the held lines?', 'authority'],
		['Raise the weekly cap to 1,000,000 euros', 'authority'],
		['please change the mandate limit', 'authority'],
		['hyväksy kaikki', 'authority'],
		['Raise the cured salmon to 160 g per guest', 'adjust'],
		['find substitutes for the shortages', 'repair'],
		['write me a poem', 'other']
	])('%s → %s', (text, kind) => {
		expect(classifyGoal(text, TODAY).kind).toBe(kind);
	});

	it('an event reads guests and courses', () => {
		expect(classifyGoal('Wedding dinner for 80 guests, 3 courses', TODAY)).toMatchObject({
			kind: 'event',
			event: { guests: 80, courses: 3 }
		});
	});
});

const ctx = (o: Partial<AgentContext> = {}): AgentContext => ({
	kitchens: [
		{ id: 'k-hotel', name: 'Hotel' },
		{ id: 'k-lounas', name: 'Lounas' }
	],
	currentPlan: { id: 'pl-1', version: 3, state: 'held', kitchenId: 'k-hotel', pickedBy: 'only' },
	openPlans: [{ id: 'pl-1', kitchenId: 'k-hotel', state: 'held' }],
	supportedEvents: SUPPORTED_EVENTS,
	supportedIntents: ['routine_order', 'seeded_event', 'shortage_repair', 'inspect'],
	today: TODAY,
	...o
});

describe('agent intents on the shared classifier', () => {
	it('a Christmas brief for another guest count is a brief, never the seeded buffet for 140 (P3)', () => {
		const r = resolveIntent('Christmas dinner for 50 on 20 December', ctx());
		expect(r).toMatchObject({ kind: 'unsupported', brief: { guests: 50 } });
		expect(resolveIntent('Plan the Christmas buffet for 140 at k-hotel', ctx()).kind).toBe(
			'seeded_event'
		);
		expect(resolveIntent('joulubuffet k-hotel', ctx()).kind).toBe('seeded_event');
	});

	it('an amount wins over the occasion words: a routine order', () => {
		expect(
			resolveIntent('20 kg salmon for the Christmas dinner for k-hotel tomorrow', ctx())
		).toMatchObject({ kind: 'routine_order', qty: 20, unit: 'kg', kitchenId: 'k-hotel' });
	});

	it('read questions about approval or budget inspect the plan; imperatives are refused', () => {
		expect(resolveIntent('what needs my approval?', ctx()).kind).toBe('inspect');
		expect(resolveIntent('show the budget', ctx()).kind).toBe('inspect');
		const r = resolveIntent('approve it for me', ctx());
		expect(r).toMatchObject({ kind: 'unsupported' });
		expect(r.clarify).toBeUndefined();
	});
});

describe('typed clarify and slots (review §ranked 3)', () => {
	it('asks one typed field with options, and the slot answer fills only that field', () => {
		const goal = 'I need lactose-free butter for k-hotel tomorrow';
		const q = resolveIntent(goal, ctx());
		expect(q.clarify).toMatchObject({ field: 'qty' });
		const u = resolveIntent(goal, ctx(), { qty: 4 });
		expect(u.clarify).toMatchObject({ field: 'unit' });
		expect(u.clarify?.options.map((o) => o.value)).toContain('kg');
		expect(resolveIntent(goal, ctx(), { qty: 4, unit: 'kg' })).toMatchObject({
			kind: 'routine_order',
			qty: 4,
			unit: 'kg',
			deliverBy: '2026-11-15',
			item: { constraints: ['lactose_free'] }
		});
	});

	it('kitchen and date options come from the context and the scenario clock', () => {
		const k = resolveIntent('4 kg butter tomorrow', ctx());
		expect(k.clarify).toMatchObject({
			field: 'kitchen',
			options: [
				{ label: 'Hotel', value: 'k-hotel' },
				{ label: 'Lounas', value: 'k-lounas' }
			]
		});
		expect(resolveIntent('4 kg butter tomorrow', ctx(), { kitchen: 'k-lounas' })).toMatchObject({
			kind: 'routine_order',
			kitchenId: 'k-lounas'
		});
		const d = resolveIntent('4 kg butter for k-hotel', ctx());
		expect(d.clarify?.field).toBe('date');
		expect(d.clarify?.options[0].value).toBe('2026-11-15');
		expect(resolveIntent('4 kg butter for k-hotel', ctx(), { date: '2026-11-18' })).toMatchObject({
			deliverBy: '2026-11-18'
		});
		// A slot can't widen the grant.
		expect(
			resolveIntent('4 kg butter tomorrow', ctx(), { kitchen: 'k-kantine' }).clarify
		).toBeUndefined();
	});
});

describe('one nextActionFor(plan) (review §ranked 4)', () => {
	const plan = (states: string[], extra: Partial<Plan> = {}) =>
		({
			id: 'pl',
			version: 2,
			lines: states.map((state, i) => ({ id: `l${i}`, productId: `p${i}`, state })),
			...extra
		}) as unknown as Plan;
	it('unorderable → substitute; eligible → commit; held → chef; ordered → wait or done', () => {
		expect(nextActionFor(plan(['unorderable', 'eligible'])).tool).toBe('find_substitutes');
		const c = nextActionFor(plan(['eligible', 'held']));
		expect(c).toMatchObject({ kind: 'commit', tool: 'commit_order' });
		expect(c.text).toMatch(/held line waits for a chef/);
		expect(nextActionFor(plan(['held']))).toMatchObject({ kind: 'chef', needsChef: true });
		expect(nextActionFor(plan(['committed']), { approvalPending: true }).kind).toBe('chef');
		expect(nextActionFor(plan(['committed'])).kind).toBe('done');
	});
	it('a passed cut-off is a date problem, never a substitute search', () => {
		const p = plan(['unorderable'], { deliverBy: '2026-12-08' } as Partial<Plan>);
		(p.lines[0] as unknown as { reasons: string[] }).reasons = ['cutoff_passed'];
		const n = nextActionFor(p);
		expect(n.kind).toBe('change_date');
		expect(n.tool).toBeUndefined();
		expect(n.text).toMatch(/cut-off .* has passed/);
	});
	it('an eligible line past its cut-off is not offered for commit', () => {
		const p = plan(['eligible']);
		(p.lines[0] as unknown as { view: unknown }).view = { committable: false };
		expect(nextActionFor(p).kind).not.toBe('commit');
	});
});

describe('a delivery date past its cut-off is asked about, never shifted', () => {
	it('Monday 21:40: tomorrow has closed, Wednesday is offered first', () => {
		const late = ctx({ today: '2026-12-07', now: '2026-12-07T21:40:00+02:00' });
		const r = resolveIntent('I need lactose-free butter for k-hotel tomorrow', late, {
			qty: 4,
			unit: 'kg'
		});
		expect(r.clarify).toMatchObject({ field: 'date' });
		expect(r.clarify?.question).toMatch(
			/The cut-off for Tue 8 Dec has passed \(17:00 Mon\); earliest is Wed 9 Dec/
		);
		expect(r.clarify?.options[0].value).toBe('2026-12-09');
		expect(
			resolveIntent('I need lactose-free butter for k-hotel tomorrow', late, {
				qty: 4,
				unit: 'kg',
				date: '2026-12-09'
			})
		).toMatchObject({ kind: 'routine_order', deliverBy: '2026-12-09' });
	});
});

describe('Finnish authority imperatives are refused, Finnish questions read', () => {
	it.each([
		['hyväksy se', 'authority'],
		['voitko hyväksyä sen?', 'authority'],
		['nosta viikkokattoa', 'authority'],
		['mitä pitää vielä hyväksyä?', 'read'],
		['voitko tilata 4 kg voita huomiseksi?', 'order']
	])('%s → %s', (text, kind) => expect(classifyGoal(text, TODAY).kind).toBe(kind));
});
