import { describe, expect, it } from 'vitest';
import { applyOps, emptyState } from './state';
import type { Actor, Line, OpEnvelope, Order, Plan, Receipt } from './contracts';

const scope = { workspaceId: 'ws', runId: 'run' };
const at = '2026-12-17T10:00:00+02:00';
let seq = 0;
const env = (op: OpEnvelope['op'], actor: Actor): OpEnvelope => ({
	...scope,
	seq: ++seq,
	at,
	actor,
	via: 'test',
	op
});
const agent: Actor = { kind: 'kitchen_agent', id: 'agent' };
const ext: Actor = { kind: 'external_agent', id: 'ext' };

const line = (id: string, state: Line['state'], tier: Line['tier']): Line => ({
	id,
	productId: '476768',
	qty: { value: 13, unit: 'ST' },
	state,
	tier,
	reasons: [],
	offer: null,
	lineCents: 20059,
	provenance: { source: 'seed' }
});

const plan = (createdBy: Actor): Plan => ({
	...scope,
	id: 'p1',
	kitchenId: 'k-hotel',
	version: 2,
	state: 'held',
	deliverBy: '2026-12-19',
	needs: [],
	lines: [line('l-act', 'eligible', 'act'), line('l-held', 'held', 'sign_off')],
	totalCents: 40118,
	termsHash: 'h',
	createdBy
});

const commit = (lineIds: string[], authority: Order['authority'], id = 'o1'): OpEnvelope['op'] => {
	const order: Order = {
		...scope,
		id,
		planId: 'p1',
		planVersion: 2,
		kitchenId: 'k-hotel',
		lines: lineIds.map((lineId) => ({
			lineId,
			productId: '476768',
			qty: { value: 13, unit: 'ST' },
			unitCents: 1543,
			lineCents: 20059
		})),
		totalCents: 20059 * lineIds.length,
		termsHash: 'h',
		deliverBy: '2026-12-19',
		committedBy: agent,
		committedAt: at,
		idempotencyKey: id,
		authority
	};
	const receipt: Receipt = {
		...scope,
		id: `r-${id}`,
		orderId: id,
		confirmed: [],
		awaitingSupplier: [],
		at,
		provenance: { source: 'simulator' }
	};
	return { type: 'CommitOrder', outcome: { result: 'committed', order, receipt } };
};

describe('commit authority and partial commits', () => {
	it('commits act-tier lines within the mandate and keeps the plan open for held lines', () => {
		seq = 0;
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan: plan(agent) }, agent),
			env(commit(['l-act'], 'mandate'), agent)
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const p = r.value.plans.p1;
		expect(p.state).toBe('held');
		expect(p.lines.find((l) => l.id === 'l-act')?.state).toBe('committed');
	});

	it('refuses a held line without an approval', () => {
		seq = 0;
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan: plan(agent) }, agent),
			env(commit(['l-held'], 'mandate'), agent)
		]);
		expect(!r.ok && r.error.code).toBe('FORBIDDEN');
	});

	it('refuses a mandate commit by an external agent (eval s5)', () => {
		seq = 0;
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan: plan(ext) }, ext),
			env(commit(['l-act'], 'mandate'), ext)
		]);
		expect(!r.ok && r.error.code).toBe('FORBIDDEN');
	});

	it('commits a held line with a granted approval bound to the same terms, then closes the plan', () => {
		seq = 0;
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan: plan(agent) }, agent),
			env(commit(['l-act'], 'mandate', 'o1'), agent),
			env(
				{
					type: 'RecordApproval',
					approval: {
						...scope,
						id: 'a1',
						planId: 'p1',
						planVersion: 2,
						termsHash: 'h',
						mandateVersion: 1,
						lineIds: ['l-held'],
						tier: 'sign_off',
						state: 'granted',
						requestedBy: agent,
						decidedBy: { kind: 'approver', id: 'chef-phone' },
						expiresAt: '2026-12-18T10:00:00+02:00'
					}
				},
				{ kind: 'approver', id: 'chef-phone' }
			),
			env(commit(['l-held'], { approvalId: 'a1' }, 'o2'), agent)
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.plans.p1.state).toBe('committed');
		const again = applyOps(r.value, [env(commit(['l-held'], { approvalId: 'a1' }, 'o3'), agent)]);
		expect(!again.ok && again.error.code).toBe('DUPLICATE');
	});
});
