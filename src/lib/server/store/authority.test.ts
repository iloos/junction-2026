/** F8: a mixed commit (granted approval + act-tier lines) names, line by line, what allowed each line. */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Order } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { applyOps } from '$lib/core/state';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

type Kind = keyof typeof SCOPES_BY_ACTOR;
const ctx = (kind: Kind): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const USUAL = '464201'; // in k-hotel's usual products: act tier
const NEW = '472817'; // never ordered by k-hotel: new_sku, held for sign-off

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	// Valio states no stock for this milk (≥999999 = unknown); these tests need a product in known stock.
	env.overlay.setAvailability({ productId: '464201', amount: 5000, label: 'test: known stock' });
	h = createHandlers(env.ports);
});

async function mixedPlan() {
	const placed = must(
		await h.place_order(ctx('kitchen_agent'), {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-10',
			idempotencyKey: 'mixed',
			lines: [
				{ productId: USUAL, qty: 10, unit: 'ST' },
				{ productId: NEW, qty: 1, unit: 'KI' }
			]
		})
	);
	const [usual, fresh] = placed.plan.lines;
	expect(usual).toMatchObject({ state: 'eligible', tier: 'act' });
	expect(fresh.state).toBe('held');
	expect(fresh.reasons).toContain('new_sku');
	const view = must(await h.get_plan(ctx('chef'), { planId: placed.plan.id }));
	const approval = view.approval!;
	expect(approval.lineIds).toEqual([fresh.id]);
	must(
		await h.approve(ctx('approver'), {
			approvalId: approval.id,
			planVersion: approval.planVersion,
			termsHash: approval.termsHash,
			decision: 'grant'
		})
	);
	return { plan: view.plan, usual, fresh, approvalId: approval.id };
}

describe('per-line authority', () => {
	it('a mixed commit buys granted ∪ act lines and names the mandate or the approval on each', async () => {
		const { plan, usual, fresh, approvalId } = await mixedPlan();
		const c = must(
			await h.commit_order(ctx('chef'), {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: 'mixed-commit'
			})
		);
		expect([...c.committedLineIds].sort()).toEqual([usual.id, fresh.id].sort());
		const state = await env.ports.store.load('ws-demo', 'run-1');
		const order = state.orders[c.orderId];
		expect(order.authority).toEqual({ approvalId });
		const by = new Map(order.lines.map((l) => [l.lineId, l.authority]));
		expect(by.get(usual.id)).toBe('mandate');
		expect(by.get(fresh.id)).toEqual({ approvalId });
	});

	it('the reducer refuses an order line that names an approval which does not cover it', async () => {
		const { plan, usual, fresh, approvalId } = await mixedPlan();
		const state = await env.ports.store.load('ws-demo', 'run-1');
		const cur = state.plans[plan.id];
		const order = (lineAuth: Order['lines'][number]['authority']) =>
			({
				workspaceId: 'ws-demo',
				runId: 'run-1',
				id: 'or-forged',
				planId: cur.id,
				planVersion: cur.version,
				kitchenId: cur.kitchenId,
				lines: [usual, fresh].map((l) => ({
					lineId: l.id,
					productId: l.productId,
					qty: l.qty,
					unitCents: l.offer!.price!.unitCents,
					lineCents: l.lineCents!,
					authority: l.id === usual.id ? lineAuth : { approvalId }
				})),
				totalCents: 0,
				termsHash: cur.termsHash!,
				deliverBy: cur.deliverBy,
				committedBy: { kind: 'chef', id: 'chef-1' },
				committedAt: '2026-12-07T21:40:00+02:00',
				idempotencyKey: 'forged',
				authority: { approvalId }
			}) as Order;
		const commit = (o: Order) =>
			applyOps(state, [
				{
					workspaceId: 'ws-demo',
					runId: 'run-1',
					seq: state.seq + 1,
					actor: { kind: 'chef', id: 'chef-1' },
					via: 'test',
					at: '2026-12-07T21:40:00+02:00',
					op: {
						type: 'CommitOrder',
						outcome: {
							result: 'committed',
							order: o,
							receipt: { id: 'rc-forged', orderId: o.id, confirmed: [], awaitingSupplier: [] }
						}
					}
				} as never
			]);
		// The usual line claims the approval, which never listed it: refused.
		const forged = commit(order({ approvalId }));
		expect(forged.ok ? null : forged.error.code).toBe('FORBIDDEN');
		// Named as the mandate (act tier), it passes.
		expect(commit(order('mandate')).ok).toBe(true);
		// The held line can't claim the mandate.
		const held = order('mandate');
		held.lines[1].authority = 'mandate';
		const r = commit(held);
		expect(r.ok ? null : r.error.code).toBe('FORBIDDEN');
	});

	it('a second commit with another key after the lines are bought replays that receipt, not an error', async () => {
		const { plan } = await mixedPlan();
		const first = must(
			await h.commit_order(ctx('chef'), {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: 'k1'
			})
		);
		expect(first.committedLineIds.length).toBe(2);
		for (const lineIds of [undefined, first.committedLineIds]) {
			const again = await h.commit_order(ctx('chef'), {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: `k2-${lineIds ? 'explicit' : 'default'}`,
				...(lineIds ? { lineIds } : {})
			});
			// Already ordered on the same terms by one order: its receipt answers, and nothing is bought twice.
			expect(again.ok ? again.value : again.error).toMatchObject({
				receiptId: first.receiptId,
				replayed: true
			});
		}
	});
});
