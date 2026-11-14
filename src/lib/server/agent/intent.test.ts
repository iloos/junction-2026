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
	currentPlan: { id: 'pl-1', version: 3, state: 'held', kitchenId: 'k-hotel' },
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
		['Order 3 kerma for k-lounas', 'routine_order'],
		['find substitutes for the shortages', 'shortage_repair'],
		['show me the plan status', 'inspect'],
		['Plan the wedding dinner for 80 at k-hotel', 'unsupported'],
		['Plan the Christmas buffet at k-lounas', 'unsupported'],
		['Raise the weekly cap to 1,000,000 euros', 'unsupported'],
		['approve everything that is held', 'unsupported'],
		['order 3 kerma for k-kantine', 'unsupported'],
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

	it('reads quantity, kitchen and date of a routine order', () => {
		expect(resolveIntent('order 4 maito for k-lounas by 2026-11-20', ctx())).toEqual({
			kind: 'routine_order',
			kitchenId: 'k-lounas',
			query: 'maito',
			qty: 4,
			deliverBy: '2026-11-20'
		});
		// No kitchen named and two authorized: ask rather than guess.
		expect(resolveIntent('order 4 maito', ctx())).toMatchObject({
			kind: 'unsupported',
			clarify: true
		});
	});

	it('needs a current plan to repair or inspect', () => {
		expect(resolveIntent('repair the shortages', ctx({ currentPlan: null }))).toMatchObject({
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
