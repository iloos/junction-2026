import { describe, expect, it } from 'vitest';
import type { Approval, Line } from '$lib/core/contracts';
import { acceptAll, lineDecisions } from './line-decisions';

const line = (id: string, tier: string, lineCents: number) =>
	({ id, tier, lineCents }) as unknown as Line;
const appr = (id: string, state: Approval['state'], lineIds: string[]) =>
	({ id, state, lineIds, planVersion: 3, termsHash: 'h' }) as unknown as Approval;

const lines = [line('a', 'propose', 100), line('b', 'propose', 200), line('c', 'sign_off', 50)];

describe('line decisions', () => {
	it('reads a split approval line by line', () => {
		const d = lineDecisions(
			lines,
			[appr('A', 'granted', ['a']), appr('B', 'pending', ['b', 'c'])],
			null
		);
		expect(d.get('a')?.state).toBe('granted');
		expect(d.get('b')).toMatchObject({ state: 'pending', signOff: false });
		expect(d.get('c')).toMatchObject({ state: 'pending', signOff: true });
	});
	it('falls back to the one current approval', () => {
		expect(lineDecisions(lines, undefined, appr('B', 'pending', ['b'])).get('b')?.state).toBe(
			'pending'
		);
	});
	it('accepts all but the sign-off lines, grouped by approval', () => {
		const d = lineDecisions(lines, [appr('B', 'pending', ['a', 'b', 'c'])], null);
		const all = acceptAll(lines, d);
		expect(all).toMatchObject({ count: 2, cents: 300, signOff: 1 });
		expect(all.byApproval.get('B')?.lineIds).toEqual(['a', 'b']);
	});
});
