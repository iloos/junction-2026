import { describe, expect, it } from 'vitest';
import { applyOps, emptyState } from './state';
import { termsHash } from './hash';
import type { Approval, OpEnvelope, Plan } from './contracts';

const scope = { workspaceId: 'ws', runId: 'run' };
const chef = { kind: 'chef' as const, id: 'chef-1' };
let seq = 0;
const env = (op: OpEnvelope['op'], actor: OpEnvelope['actor'] = chef): OpEnvelope => ({
	...scope,
	seq: ++seq,
	at: '2026-12-17T10:00:00+02:00',
	actor,
	via: 'test',
	op
});

async function quotedPlan(unitCents: number): Promise<Plan> {
	const hash = await termsHash({
		deliverBy: '2026-12-19',
		lines: [{ productId: '462919', qty: 8, unit: 'ST', unitCents }]
	});
	return {
		...scope,
		id: 'p1',
		kitchenId: 'k-hotel',
		version: 0,
		state: 'draft',
		deliverBy: '2026-12-19',
		needs: [],
		lines: [],
		totalCents: null,
		termsHash: hash,
		createdBy: chef
	};
}

describe('applyOps', () => {
	it('voids a granted approval when the quoted terms change (eval s4)', async () => {
		seq = 0;
		const plan = await quotedPlan(2920);
		const approval: Approval = {
			...scope,
			id: 'a1',
			planId: 'p1',
			planVersion: 0,
			termsHash: plan.termsHash!,
			mandateVersion: 1,
			lineIds: [],
			tier: 'sign_off',
			state: 'granted',
			requestedBy: { kind: 'kitchen_agent', id: 'agent' },
			decidedBy: { kind: 'approver', id: 'chef-phone' },
			expiresAt: '2026-12-18T10:00:00+02:00'
		};
		const newHash = await termsHash({
			deliverBy: '2026-12-19',
			lines: [{ productId: '462919', qty: 8, unit: 'ST', unitCents: 3150 }]
		});
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan }),
			env({ type: 'RecordApproval', approval }),
			env({
				type: 'RecordOffer',
				planId: 'p1',
				baseVersion: 0,
				offers: [],
				lines: [],
				planState: 'held',
				totalCents: 25200,
				termsHash: newHash
			})
		]);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.approvals.a1.state).toBe('invalidated');
	});

	it('refuses an approval granted by an external agent (eval s5)', async () => {
		seq = 0;
		const plan = await quotedPlan(2920);
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan }),
			env(
				{
					type: 'RecordApproval',
					approval: {
						...scope,
						id: 'a1',
						planId: 'p1',
						planVersion: 0,
						termsHash: plan.termsHash!,
						mandateVersion: 1,
						lineIds: [],
						tier: 'sign_off',
						state: 'granted',
						requestedBy: { kind: 'external_agent', id: 'ext' },
						decidedBy: { kind: 'external_agent', id: 'ext' },
						expiresAt: '2026-12-18T10:00:00+02:00'
					}
				},
				{ kind: 'external_agent', id: 'ext' }
			)
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
	});

	it('rejects an edit computed on an old version', async () => {
		seq = 0;
		const plan = await quotedPlan(2920);
		const r = applyOps(emptyState('ws', 'run'), [
			env({ type: 'CreatePlan', plan }),
			env({
				type: 'EditLine',
				planId: 'p1',
				baseVersion: 3,
				lineId: 'l1',
				line: null,
				summary: 'x'
			})
		]);
		expect(!r.ok && r.error.code).toBe('STALE_VERSION');
	});
});
