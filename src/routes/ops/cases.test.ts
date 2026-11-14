import { describe, expect, it } from 'vitest';
import { applyOps, emptyState } from '$lib/core/state';
import { SCENARIO } from '$lib/core/scenario';
import { SYNTH_PRODUCTS, SYNTH_WORKSPACE, syntheticRun } from '$lib/server/bus/synthetic';
import { buildCases, coverage, kitchenHref } from './cases';

function stateAfter(steps: number) {
	const ops = syntheticRun({ runId: 'r', startSeq: 1 })
		.slice(0, steps)
		.flatMap((e) => (e.kind === 'op' ? [e.envelope] : []));
	const r = applyOps(emptyState(SYNTH_WORKSPACE, 'r'), ops);
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}

describe('ops cases', () => {
	it('lists blocked first, then sign-off, then chef, with owners and next steps', () => {
		const cases = buildCases(stateAfter(19), SYNTH_PRODUCTS, {});
		expect(cases.map((c) => [c.tone, c.owner])).toEqual([
			['blocked', 'Chef'], // salmon: unorderable, trout substitute proposed
			['blocked', 'Kitchen agent'], // the refused hotel commit
			['sign_off', 'Approver'], // casserole
			['propose', 'Chef'] // trout
		]);
		expect(cases.every((c) => c.deadline === SCENARIO.cutoff)).toBe(true);
	});

	it('links a line case to its plan, version and kitchen', () => {
		const c = buildCases(stateAfter(19), SYNTH_PRODUCTS, {}).find((x) =>
			x.title.startsWith('Kirjolohi')
		);
		expect(kitchenHref(c!)).toBe('/?kitchen=k-hotel&plan=p-hotel&v=3');
	});

	it('reports coverage only from evidence', () => {
		const s = stateAfter(19);
		expect(coverage([s.plans['p-lounas']])).toEqual({ covered: 4, total: 4, unit: 'lines' });
		expect(coverage([])).toBeNull();
	});
});
