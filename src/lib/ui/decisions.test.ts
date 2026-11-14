import { describe, expect, it } from 'vitest';
import type { Approval, Line, Plan } from '$lib/core/contracts';
import { decisionCount, decisionsDue, decisionsOf, titleOf } from './decisions';

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

describe('decision titles say what approving does', () => {
	const labels = new Map([
		['n1', 'Lanttulaatikko (swede casserole)'],
		['n2', 'Joulutorttu (prune star tart)'],
		['n3', 'Joulukinkku (Christmas ham)']
	]);
	const l = (o: Partial<Line>) => ({ id: 'x', reasons: [], ...o }) as unknown as Line;
	const mih = { id: 's', kind: 'make_in_house' as const };
	it('names the dishes made in house and the allergen change', () => {
		const lines = [
			l({ needId: 'n1', strategy: mih, substituteFor: 'p1' }),
			l({ needId: 'n1', strategy: mih, substituteFor: 'p1' }),
			l({ needId: 'n2', strategy: mih, substituteFor: 'p2' })
		];
		expect(titleOf(lines, ['new_sku', 'allergen_change'], labels)).toBe(
			'Make lanttulaatikko and joulutorttu in house · allergens change'
		);
	});
	it('separates substitutes from new products', () => {
		const lines = [
			l({ needId: 'n3', substituteFor: 'p3' }),
			l({ needId: 'n1' }),
			l({ needId: 'n2' })
		];
		expect(titleOf(lines, ['new_sku'], labels)).toBe(
			'Use a substitute for joulukinkku · Buy 2 new products'
		);
	});
	it('every decision carries a title', () => {
		for (const d of decisionsOf(plan, approval)) expect(d.title).toMatch(/^Buy \d new products?/);
	});
});

describe('one deadline rule', () => {
	it('is the earliest of the approval expiry and the open line cut-offs', () => {
		const lines = [
			{
				id: 'a',
				state: 'held',
				reasons: ['new_sku'],
				tier: 'propose',
				offer: { availability: { closingTime: '2026-12-08T13:00:00.000Z' } }
			},
			{
				id: 'b',
				state: 'committed',
				reasons: [],
				tier: 'act',
				offer: { availability: { closingTime: '2026-12-07T10:00:00.000Z' } }
			}
		] as unknown as Line[];
		const p = { lines, needs: [] } as unknown as Plan;
		const ap = {
			id: 'x',
			state: 'pending',
			lineIds: ['a', 'b'],
			expiresAt: '2026-12-08T19:40:00.000Z'
		} as unknown as Approval;
		expect(decisionsDue(p, ap)).toBe('2026-12-08T13:00:00.000Z');
		expect(decisionsOf(p, ap)[0].due).toBe('2026-12-08T13:00:00.000Z');
	});
});
