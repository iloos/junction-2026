import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from './contracts';
import { applyOps, emptyState } from './state';

const refusal = (seq: number, planId?: string): OpEnvelope => ({
	workspaceId: 'ws-t',
	runId: 'run-t',
	seq,
	at: '2026-12-07T19:40:00.000Z',
	actor: { kind: 'external_agent', id: 'judge' },
	via: 'mcp:approve',
	op: {
		type: 'RecordRefusal',
		tool: 'approve',
		code: 'FORBIDDEN',
		message: 'external_agent may not call approve (needs scope approve)',
		...(planId ? { planId } : {})
	}
});

describe('RecordRefusal', () => {
	it('records the refused call and changes nothing else', () => {
		const before = emptyState('ws-t', 'run-t');
		const r = applyOps(before, [refusal(1, 'pl-1'), refusal(2)]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.refusals).toEqual([
			{
				seq: 1,
				tool: 'approve',
				code: 'FORBIDDEN',
				actor: { kind: 'external_agent', id: 'judge' },
				planId: 'pl-1'
			},
			{ seq: 2, tool: 'approve', code: 'FORBIDDEN', actor: { kind: 'external_agent', id: 'judge' } }
		]);
		expect(r.value.plans).toBe(before.plans);
		expect(r.value.approvals).toBe(before.approvals);
		expect(r.value.orders).toBe(before.orders);
		expect(r.value.seq).toBe(2);
	});
});
