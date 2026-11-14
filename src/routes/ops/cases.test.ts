import { describe, expect, it } from 'vitest';
import type { Approval, Line, Plan } from '$lib/core/contracts';
import type { WorkspaceState } from '$lib/core/state';
import { applyOps, emptyState } from '$lib/core/state';
import { SCENARIO } from '$lib/core/scenario';
import { SYNTH_PRODUCTS, SYNTH_WORKSPACE, syntheticRun } from '$lib/server/bus/synthetic';
import { buildCases, coverage, kitchenHref, pendingApprovalOf, withApprovals } from './cases';

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
			['blocked', 'Kitchen agent'], // the refused hotel commit
			['sign_off', 'Approver'], // casserole
			['propose', 'Chef'] // trout, which replaces the salmon outage (no separate salmon case)
		]);
		expect(cases.find((c) => c.owner === 'Chef')?.detail).toMatch(/replaces/);
		// The synthetic run has no offers, so every deadline falls back to the scenario cut-off.
		expect(cases.every((c) => c.deadline === SCENARIO.cutoff)).toBe(true);
	});

	it('links a line case to its plan, version and kitchen', () => {
		const c = buildCases(stateAfter(19), SYNTH_PRODUCTS, {}).find((x) =>
			x.title.startsWith('Kirjolohi')
		);
		expect(kitchenHref(c!)).toBe('/?kitchen=k-hotel&plan=p-hotel&v=3');
		expect(kitchenHref(c!, { ws: 'ws-j-abcdefghijklmnop', run: 'run-x' })).toBe(
			'/?ws=ws-j-abcdefghijklmnop&run=run-x&kitchen=k-hotel&plan=p-hotel&v=3'
		);
	});

	it('closes an outage once its substitute is committed, and when the plan view says the need is met', () => {
		const s = stateAfter(19);
		const hotel = s.plans['p-hotel'];
		const committed = {
			...hotel,
			lines: hotel.lines.map((l) => (l.substituteFor ? { ...l, state: 'committed' as const } : l))
		};
		const after = buildCases(
			{ ...s, plans: { ...s.plans, 'p-hotel': committed } },
			SYNTH_PRODUCTS,
			{}
		);
		expect(after.some((c) => c.lines.some((l) => l.name.startsWith('Kirjolohi')))).toBe(false);
		expect(after.some((c) => c.state === 'Cannot be ordered')).toBe(false);
		// An outage with no alternative stays open until the view says its need has nothing unresolved.
		const outage = { ...hotel.lines.find((l) => l.state === 'unorderable')!, needId: 'need-x' };
		const bare = { ...hotel, lines: [outage] };
		expect(buildCases({ ...s, plans: { 'p-hotel': bare } }, SYNTH_PRODUCTS, {})[0]?.state).toBe(
			'Cannot be ordered'
		);
		const m = (value: number) => ({ value, unit: 'kg' as const });
		const met = {
			...bare,
			view: {
				asOf: '2026-12-07T21:40:00+02:00',
				mandateVersion: 1,
				fulfilment: [
					{
						needId: 'need-x',
						label: 'x',
						required: m(1),
						supplierConfirmed: m(1),
						awaitingSupplier: m(0),
						plannedKnown: m(0),
						plannedUnknown: m(0),
						unresolved: m(0),
						excess: m(0),
						status: 'confirmed' as const,
						allocations: []
					}
				]
			}
		};
		const lines = buildCases({ ...s, plans: { 'p-hotel': met as never } }, SYNTH_PRODUCTS, {});
		expect(lines.filter((c) => c.planId === 'p-hotel' && c.lines.length)).toEqual([]);
	});

	it('groups lines with the same cause in one plan into one case', () => {
		const s = stateAfter(19);
		const plan = Object.values(s.plans).find((p) => p.lines.some((l) => l.tier === 'sign_off'))!;
		const one = plan.lines.find((l) => l.tier === 'sign_off' && l.state === 'held')!;
		const twin = { ...one, id: `${one.id}-twin`, productId: `${one.productId}9` };
		const grouped = { ...plan, lines: [...plan.lines, twin] };
		const cases = buildCases(
			{ ...s, plans: { ...s.plans, [plan.id]: grouped } },
			SYNTH_PRODUCTS,
			{}
		);
		const signOff = cases.filter((c) => c.tone === 'sign_off' && c.planId === plan.id);
		expect(signOff).toHaveLength(1);
		expect(signOff[0].lines).toHaveLength(2);
		expect(signOff[0].title).toMatch(/^2 lines: /);
	});

	it('counts coverage from the plan view: unknown supply and unresolved need are not cover (D10)', () => {
		const s = stateAfter(19);
		const plan = s.plans['p-lounas'];
		// Without a view (the simulated run), coverage is not reported rather than guessed from line states.
		expect(coverage([plan])).toBeNull();
		expect(coverage([])).toBeNull();
		const m = (value: number) => ({ value, unit: 'kg' as const });
		const fv = (needId: string, unresolved: number, unknown: number) => ({
			needId,
			label: needId,
			required: m(10),
			supplierConfirmed: m(0),
			awaitingSupplier: m(0),
			plannedKnown: m(10 - unresolved - unknown),
			plannedUnknown: m(unknown),
			unresolved: m(unresolved),
			excess: m(0),
			status: 'planned' as const,
			allocations: []
		});
		const view = {
			asOf: '2026-12-07T21:40:00+02:00',
			mandateVersion: 1,
			fulfilment: [fv('a', 0, 0), fv('b', 0, 4), fv('c', 3, 0)]
		};
		expect(coverage([{ ...plan, view } as never])).toEqual({ covered: 1, total: 3 });
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

	it('reads lines a granted approval of the current version covers as approved, not waiting', () => {
		const line = (id: string) => ({ id, state: 'held' }) as unknown as Line;
		const plan = { id: 'p1', version: 3, lines: [line('a'), line('b')] } as unknown as Plan;
		const approval = (state: string, planVersion: number) =>
			({ id: 'ap', planId: 'p1', planVersion, state, lineIds: ['a'] }) as unknown as Approval;
		const s = (ap: Approval) =>
			({ ...emptyState('ws', 'r'), plans: { p1: plan }, approvals: { ap } }) as WorkspaceState;
		expect(withApprovals(s(approval('granted', 3))).plans.p1.lines.map((l) => l.state)).toEqual([
			'eligible',
			'held'
		]);
		// Pending, or granted on an older version (the plan changed since): still waiting.
		expect(withApprovals(s(approval('pending', 3))).plans.p1.lines[0].state).toBe('held');
		expect(withApprovals(s(approval('granted', 2))).plans.p1.lines[0].state).toBe('held');
	});
});

describe('pending approval of the current version only (OM-6)', () => {
	it('ignores an older version’s approval left pending by a same-terms re-quote', () => {
		const plan = { id: 'p1', version: 4, lines: [] } as unknown as Plan;
		const ap = (id: string, planVersion: number) =>
			({ id, planId: 'p1', planVersion, state: 'pending', lineIds: ['a'] }) as unknown as Approval;
		const s = {
			...emptyState('ws', 'r'),
			plans: { p1: plan },
			approvals: { old: ap('old', 3), cur: ap('cur', 4) }
		} as WorkspaceState;
		expect(pendingApprovalOf(s, 'p1')?.id).toBe('cur');
		const onlyOld = { ...s, approvals: { old: ap('old', 3) } } as WorkspaceState;
		expect(pendingApprovalOf(onlyOld, 'p1')).toBeUndefined();
	});
});
