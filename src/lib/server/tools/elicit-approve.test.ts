/**
 * D22: a chef's own AI client approves by elicitation. Accept approves exactly the shown terms; decline approves
 * nothing; stale terms are refused; a client that can't elicit gets the link; a sign-off needs the app; an outside
 * key can never approve; and no approve passes for a chef key outside the elicitation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_CAPABILITIES_META_KEY, isInputRequiredResult } from '@modelcontextprotocol/server';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '$lib/server/store/db-ports';
import { approveViaElicitation, type ElicitReq } from './elicit-approve';

const env = { JUDGE_KEY_SECRET: 'a-test-secret-long-enough-for-hmac' };
const base = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	via: 'mcp'
};
const chefClient: CallContext = {
	...base,
	actor: { kind: 'chef', id: 'chef-client-test' },
	scopes: ['read', 'plan', 'order', 'approve'],
	approveBy: 'elicitation'
};
const chef: CallContext = {
	...base,
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef
};
const outside: CallContext = {
	...base,
	actor: { kind: 'external_agent', id: 'judge-x' },
	scopes: SCOPES_BY_ACTOR.external_agent
};
const caps = { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} } };
const req = (
	o: Partial<{ responses: Record<string, unknown>; state: string; elicit: boolean }> = {}
): ElicitReq => ({
	envelope: o.elicit === false ? {} : caps,
	...(o.responses ? { inputResponses: o.responses } : {}),
	requestState: () => o.state
});

let h: ToolHandlers;
let never: (kitchenId: string) => Promise<readonly string[]>;
let plan: Plan;
let approvalId: string;
beforeEach(async () => {
	const db = await createDbPorts();
	h = createHandlers(db.ports);
	never = async (id) =>
		(await db.ports.store.kitchens('ws-demo')).find((k) => k.id === id)?.mandate.neverDelegate ??
		[];
	// Over the café's €150 line cap: held for a person (propose), not a never-delegate sign-off.
	const r = await h.place_order(chef, {
		kitchenId: 'k-cafe',
		deliverBy: '2026-12-11',
		idempotencyKey: 'elicit',
		lines: [{ productId: '464237', qty: 60, unit: 'ST' }]
	});
	if (!r.ok) throw new Error(r.error.message);
	plan = r.value.plan;
	approvalId = r.value.approvalId!;
});
const args = () => ({
	approvalId,
	planVersion: plan.version,
	termsHash: plan.termsHash!,
	decision: 'grant' as const
});
const stateOf = (r: unknown) => (r as { requestState: string }).requestState;
const approvalState = async () =>
	(
		(await h.get_plan(chef, { planId: plan.id })) as {
			ok: true;
			value: { approval: { state: string } | null };
		}
	).value.approval?.state;

describe('approve by elicitation (D22)', () => {
	it('shows the exact terms, and an accept approves exactly those', async () => {
		expect(approvalId).toBeTruthy();
		const first = await approveViaElicitation(chefClient, args(), req(), h, env, never);
		expect(isInputRequiredResult(first)).toBe(true);
		const message = JSON.stringify(first);
		expect(message).toMatch(/plan version/);
		const done = await approveViaElicitation(
			chefClient,
			args(),
			req({
				responses: { approve: { action: 'accept', content: { approve: true } } },
				state: stateOf(first)
			}),
			h,
			env,
			never
		);
		expect('isError' in done && done.isError).toBeFalsy();
		expect(await approvalState()).toBe('granted');
	});

	it('a decline approves nothing', async () => {
		const first = await approveViaElicitation(chefClient, args(), req(), h, env, never);
		const done = await approveViaElicitation(
			chefClient,
			args(),
			req({ responses: { approve: { action: 'decline' } }, state: stateOf(first) }),
			h,
			env,
			never
		);
		expect(JSON.stringify(done)).toMatch(/Not approved/);
		expect(await approvalState()).toBe('pending');
	});

	it('stale terms are refused, and a forged state is not accepted', async () => {
		const stale = await approveViaElicitation(
			chefClient,
			{ ...args(), planVersion: plan.version - 1 },
			req(),
			h,
			env,
			never
		);
		expect(JSON.stringify(stale)).toMatch(/STALE_VERSION/);
		const forged = await approveViaElicitation(
			chefClient,
			args(),
			req({
				responses: { approve: { action: 'accept', content: { approve: true } } },
				state: 'forged'
			}),
			h,
			env,
			never
		);
		expect('isError' in forged && forged.isError).toBe(true);
		expect(await approvalState()).toBe('pending');
	});

	it('a client without elicitation gets the link; a chef key never approves outside it; an outside key never', async () => {
		const noElicit = await approveViaElicitation(
			chefClient,
			args(),
			req({ elicit: false }),
			h,
			env,
			never
		);
		expect(JSON.stringify(noElicit)).toMatch(/link/);
		const direct = await h.approve(chefClient, args());
		expect(!direct.ok && direct.error.sub).toBe('elicitation_required');
		const agent = await h.approve(outside, args());
		expect(!agent.ok && agent.error.code).toBe('FORBIDDEN');
		expect(await approvalState()).toBe('pending');
	});

	it('a never-delegate sign-off needs the app', async () => {
		// The hotel never delegates a new product: a product it hasn't ordered before is a sign-off.
		const r = await h.place_order(chef, {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-11',
			idempotencyKey: 'signoff',
			lines: [{ productId: '464237', qty: 2, unit: 'ST' }]
		});
		if (!r.ok) throw new Error(r.error.message);
		const p = r.value.plan;
		const got = await h.get_plan(chef, { planId: p.id });
		expect(got.ok && p.lines.some((l) => l.reasons.includes('new_sku'))).toBe(true);
		const out = await approveViaElicitation(
			chefClient,
			{
				approvalId: r.value.approvalId!,
				planVersion: p.version,
				termsHash: p.termsHash!,
				decision: 'grant'
			},
			req(),
			h,
			env,
			never
		);
		expect(JSON.stringify(out)).toMatch(/sign-off in the app/);
	});
});
