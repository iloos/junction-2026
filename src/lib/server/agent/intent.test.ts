import { describe, expect, it } from 'vitest';
import type { Plan } from '$lib/core/contracts';
import { SUPPORTED_EVENTS } from './context';
import { resolveIntent } from './intent';
import { computeOutcome } from './outcome';
import type { AgentContext } from './types';

const ctx = (o: Partial<AgentContext> = {}): AgentContext => ({
	kitchens: [
		{ id: 'k-hotel', name: 'Hotel' },
		{ id: 'k-lounas', name: 'Lounas' }
	],
	currentPlan: { id: 'pl-1', version: 3, state: 'held', kitchenId: 'k-hotel', pickedBy: 'only' },
	openPlans: [{ id: 'pl-1', kitchenId: 'k-hotel', state: 'held' }],
	supportedEvents: SUPPORTED_EVENTS,
	supportedIntents: ['routine_order', 'seeded_event', 'shortage_repair', 'inspect'],
	today: '2026-11-14',
	...o
});

describe('typed intent (finding D)', () => {
	it.each([
		[
			'Plan the Christmas buffet for 140 at k-hotel and order what the mandate allows',
			'seeded_event'
		],
		['joulubuffet k-hotel', 'seeded_event'],
		['Order 3 packs kerma for k-lounas tomorrow', 'routine_order'],
		['Order 4 kg butter for k-lounas tomorrow', 'routine_order'],
		['find substitutes for the shortages', 'shortage_repair'],
		['show me the plan status', 'inspect'],
		['Plan the wedding dinner for 80 at k-hotel', 'unsupported'],
		['Plan the Christmas buffet at k-lounas', 'unsupported'],
		['Raise the weekly cap to 1,000,000 euros', 'unsupported'],
		['approve everything that is held', 'unsupported'],
		['order 3 packs kerma for k-kantine tomorrow', 'unsupported'],
		['write me a poem', 'unsupported'],
		['', 'unsupported']
	])('%s → %s', (goal, kind) => {
		expect(resolveIntent(goal, ctx()).kind).toBe(kind);
	});

	it('never turns an unsupported event into the seeded Christmas plan', () => {
		const r = resolveIntent('Plan a birthday party for 30 at k-hotel', ctx());
		expect(r).toMatchObject({ kind: 'unsupported' });
		expect((r as { reason: string }).reason).toMatch(/No seeded event/);
	});

	it('reads quantity, unit, kitchen and date of a routine order with the request parser', () => {
		expect(resolveIntent('order 4 l maito for k-lounas by 2026-11-20', ctx())).toMatchObject({
			kind: 'routine_order',
			kitchenId: 'k-lounas',
			query: 'milk',
			qty: 4,
			unit: 'l',
			item: { product: 'milk', search: ['maito'] },
			deliverBy: '2026-11-20'
		});
		// No kitchen named and two authorized: ask rather than guess.
		expect(resolveIntent('order 4 l maito tomorrow', ctx())).toMatchObject({
			kind: 'unsupported',
			clarify: true
		});
	});

	it('F4 regression: "4 kg butter tomorrow" is 4 kg physical, delivered tomorrow on the scenario clock', () => {
		const r = resolveIntent('Order 4 kg butter for k-lounas tomorrow', ctx());
		expect(r).toMatchObject({
			kind: 'routine_order',
			kitchenId: 'k-lounas',
			query: 'butter',
			qty: 4,
			unit: 'kg',
			deliverBy: '2026-11-15',
			deliverByText: 'tomorrow'
		});
		// 500 g reads as 0.5 kg, Finnish relative dates on the same clock.
		expect(resolveIntent('tilaa 500 g voita k-lounas huomenna', ctx())).toMatchObject({
			qty: 0.5,
			unit: 'kg',
			deliverBy: '2026-11-15'
		});
		// A weekday is the coming one; a weekday equal to today is next week and says so.
		const sat = resolveIntent('order 2 kg butter for k-lounas by saturday', ctx());
		expect(sat).toMatchObject({ deliverBy: '2026-11-21' });
		expect((sat as { notes: string[] }).notes.join(' ')).toMatch(/next Saturday/);
	});

	it.each([
		['order 3 kerma for k-lounas tomorrow', /unit/],
		['order 4 kg butter for k-lounas', /arrive/],
		['order 4 kg butter for k-lounas by 2026-11-01', /past/],
		['order kerma for k-lounas tomorrow', /How much/],
		['order 2 kg butter and 3 l milk for k-lounas tomorrow', /One product/],
		['order 0 kg butter for k-lounas tomorrow', /above 0/]
	])('refuses what it cannot honour, with the reason: %s', (goal, why) => {
		const r = resolveIntent(goal, ctx());
		expect(r).toMatchObject({ kind: 'unsupported', clarify: true });
		expect((r as { reason: string }).reason).toMatch(why);
	});

	it('asks which plan when the request does not say and several are open', () => {
		const two = ctx({
			currentPlan: null,
			openPlans: [
				{ id: 'pl-1', kitchenId: 'k-hotel', state: 'held' },
				{ id: 'pl-2', kitchenId: 'k-lounas', state: 'quoted' }
			]
		});
		const r = resolveIntent('show me the plan status', two);
		expect(r).toMatchObject({ kind: 'unsupported', clarify: true });
		expect((r as { reason: string }).reason).toMatch(/Which plan\? .*pl-1.*pl-2/);
	});

	it('needs a current plan to repair or inspect', () => {
		expect(
			resolveIntent('repair the shortages', ctx({ currentPlan: null, openPlans: [] }))
		).toMatchObject({
			kind: 'unsupported',
			clarify: true
		});
	});
});

const line = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
	id,
	productId: id,
	qty: { value: 1, unit: 'KPL' },
	state,
	reasons: [],
	offer: null,
	lineCents: 100,
	provenance: { source: 'seed' },
	...extra
});
const plan = (lines: unknown[], needs: { id: string; label: string }[] = []) =>
	({
		workspaceId: 'ws',
		runId: 'r',
		id: 'pl',
		kitchenId: 'k-hotel',
		version: 2,
		state: 'quoted',
		deliverBy: '2026-11-16',
		needs: needs.map((n) => ({
			...n,
			amount: { value: 1, unit: 'kg' },
			provenance: { source: 'seed' }
		})),
		lines,
		totalCents: 100,
		termsHash: 'h',
		createdBy: { kind: 'kitchen_agent', id: 'a' }
	}) as unknown as Plan;

describe('GoalOutcome from domain state (finding D)', () => {
	it('fulfilled only when every need is covered by committed lines', () => {
		const o = computeOutcome({
			intent: 'routine_order',
			plan: plan([line('a', 'committed')]),
			approval: null
		});
		expect(o.status).toBe('fulfilled');
		expect(o.confirmedNeeds.map((n) => n.needId)).toEqual(['a']);
	});

	it('eligible but uncommitted is partial, not done', () => {
		const o = computeOutcome({
			intent: 'routine_order',
			plan: plan([line('a', 'eligible')]),
			approval: null
		});
		expect(o.status).toBe('partial');
		expect(o.unconfirmedNeeds).toHaveLength(1);
	});

	it('held lines and a pending approval wait for the user', () => {
		const o = computeOutcome({
			intent: 'seeded_event',
			plan: plan([line('a', 'held', { needId: 'n1' })], [{ id: 'n1', label: 'ham' }]),
			approval: {
				id: 'ap-1',
				state: 'pending',
				planVersion: 2,
				termsHash: 'h',
				lineIds: ['a'],
				tier: 'propose'
			}
		});
		expect(o.status).toBe('awaiting_user');
		expect(o.approvalIds).toEqual(['ap-1']);
	});

	it('a need with only unorderable lines is unresolved; a substitute line resolves it', () => {
		const needs = [
			{ id: 'n1', label: 'ham' },
			{ id: 'n2', label: 'salmon' }
		];
		const out = computeOutcome({
			intent: 'seeded_event',
			plan: plan(
				[line('a', 'unorderable', { needId: 'n1' }), line('b', 'eligible', { needId: 'n2' })],
				needs
			),
			approval: null
		});
		expect(out.status).toBe('partial');
		expect(out.unresolvedNeeds.map((n) => n.needId)).toEqual(['n1']);
		const fixed = computeOutcome({
			intent: 'seeded_event',
			plan: plan(
				[
					line('a', 'unorderable', { needId: 'n1' }),
					line('a2', 'committed', { needId: 'n1', substituteFor: 'a' }),
					line('b', 'committed', { needId: 'n2' })
				],
				needs
			),
			approval: null
		});
		expect(fixed.status).toBe('fulfilled');
	});

	it('no plan is blocked, whatever the planner said', () => {
		const o = computeOutcome({
			intent: 'seeded_event',
			plan: null,
			approval: null,
			reason: 'no plan was created'
		});
		expect(o.status).toBe('blocked');
	});
});
