/**
 * Undo a reject: a person takes back a deny on the current plan version, and those lines wait for a decision again.
 * Agents never can, and a deny on an older version can't be reopened.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const as = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});

let h: ToolHandlers;
beforeEach(async () => {
	h = createHandlers((await createDbPorts()).ports);
});

describe('reopen a denied decision', () => {
	it('a person reopens a deny; the lines wait again; an agent cannot', async () => {
		const r = await h.place_order(as('chef'), {
			kitchenId: 'k-cafe',
			deliverBy: '2026-12-11',
			idempotencyKey: 'reopen',
			lines: [{ productId: '464237', qty: 60, unit: 'ST' }]
		});
		if (!r.ok) throw new Error(r.error.message);
		const { plan, approvalId } = r.value;
		const args = { approvalId: approvalId!, planVersion: plan.version, termsHash: plan.termsHash! };
		const denied = await h.approve(as('chef'), { ...args, decision: 'deny' });
		expect(denied.ok && denied.value.state).toBe('denied');

		const agent = await h.approve(as('kitchen_agent'), { ...args, decision: 'reopen' });
		expect(agent.ok).toBe(false);

		const back = await h.approve(as('chef'), { ...args, decision: 'reopen' });
		expect(back.ok && back.value.state).toBe('pending');
		const got = await h.get_plan(as('chef'), { planId: plan.id });
		expect(got.ok && (got.value as { approval: { state: string } | null }).approval?.state).toBe(
			'pending'
		);
		// It can be decided again.
		const granted = await h.approve(as('chef'), { ...args, decision: 'grant' });
		expect(granted.ok && granted.value.state).toBe('granted');
		// A grant is not reopened.
		const again = await h.approve(as('chef'), { ...args, decision: 'reopen' });
		expect(again.ok).toBe(false);
	});
});
