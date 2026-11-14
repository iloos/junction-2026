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
		// The synthetic run has no offers, so every deadline falls back to the scenario cut-off.
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

	it('takes the deadline from the line offer and sorts by real time', () => {
		const s = stateAfter(19);
		const plan = s.plans['p-hotel'];
		const trout = plan.lines.find((l) => l.id === 'h-trout')!;
		const early = '2026-12-08T09:00:00Z'; // 11:00 Helsinki, before the scenario cut-off
		const withOffer = {
			...trout,
			offer: {
				productId: trout.productId,
				price: null,
				availability: {
					kind: 'known' as const,
					amount: 40,
					logisticModel: 'Stock' as const,
					availableDate: '2026-12-10',
					closingTime: early,
					raw: null,
					provenance: { source: 'simulator' as const }
				}
			}
		};
		const s2 = {
			...s,
			plans: {
				...s.plans,
				'p-hotel': { ...plan, lines: plan.lines.map((l) => (l.id === 'h-trout' ? withOffer : l)) }
			}
		};
		const cases = buildCases(s2, SYNTH_PRODUCTS, {});
		expect(cases[0].title.startsWith('Kirjolohi')).toBe(true);
		expect(cases[0].deadline).toBe(early);
	});
});
