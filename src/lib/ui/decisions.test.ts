import { describe, expect, it } from 'vitest';
import type { Approval, Line, Plan } from '$lib/core/contracts';
import { decisionCount, decisionsDue, decisionsOf } from './decisions';

const line = (id: string, reasons: string[], tier: Line['tier'], cents: number, needId: string) =>
	({ id, reasons, tier, lineCents: cents, needId, state: 'held' }) as unknown as Line;

const plan = {
	needs: [
		{ id: 'n1', label: 'Rosolli' },
		{ id: 'n2', label: 'Kinkku' }
	],
	lines: [
		line('a', ['new_sku'], 'propose', 100, 'n1'),
		line('b', ['new_sku', 'unknown'], 'propose', 250, 'n2'),
		line('c', ['new_sku', 'allergen_change'], 'sign_off', 900, 'n2'),
		line('d', [], 'act', 50, 'n1')
	],
	view: { validUntil: '2026-12-08T13:00:00.000Z' }
} as unknown as Plan;

const approval = {
	id: 'ap1',
	state: 'pending',
	lineIds: ['a', 'b', 'c'],
	planVersion: 4,
	termsHash: 'h',
	expiresAt: '2026-12-08T14:00:00.000Z'
} as unknown as Approval;

describe('decisionsOf', () => {
	it('groups the pending approval by reason, ignoring the unknown-quantity marker', () => {
		const ds = decisionsOf(plan, approval);
		expect(ds.map((d) => d.lineIds)).toEqual([['a', 'b'], ['c']]);
		expect(ds[0].totalCents).toBe(350);
		expect(ds[0].signOff).toBe(false);
		expect(ds[1].signOff).toBe(true);
		expect(ds[0].consequence).toContain('Rosolli, Kinkku lose');
	});

	it('has no decisions without a pending approval', () => {
		expect(decisionsOf(plan, { ...approval, state: 'granted' } as Approval)).toEqual([]);
		expect(decisionsOf(plan, null)).toEqual([]);
	});

	it('is due at the plan view validity first', () => {
		expect(decisionsDue(plan, approval)).toBe('2026-12-08T13:00:00.000Z');
		expect(decisionsDue({ ...plan, view: undefined } as Plan, approval)).toBe(approval.expiresAt);
	});

	it('counts in words', () => {
		expect([0, 1, 2].map(decisionCount)).toEqual(['No decisions', '1 decision', '2 decisions']);
	});
});
