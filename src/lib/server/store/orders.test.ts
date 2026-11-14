import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type ServerEvent } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
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

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
let published: ServerEvent[];

beforeEach(async () => {
	published = [];
	// These cases order for mid-November: the clock is that Saturday, so their cut-offs are ahead.
	env = await createDbPorts({
		now: '2026-11-14T12:00:00+02:00',
		publish: (_ws, evs) => published.push(...evs)
	});
	env.overlay.clear();
	// Valio states no stock for this milk (≥999999 = unknown); these tests need a product in known stock.
	env.overlay.setAvailability({ productId: '464201', amount: 5000, label: 'test: known stock' });
	h = createHandlers(env.ports);
});

describe('order flow on PGlite (s1)', () => {
	it('holds 1,000 l milk over the caps, approves it, commits once even on retry', async () => {
		const placed = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-11-16',
				idempotencyKey: 's1-place',
				lines: [{ productId: '464201', qty: 1000, unit: 'ST' }]
			})
		);
		const line = placed.plan.lines[0];
		expect(line).toMatchObject({ state: 'held', tier: 'sign_off', lineCents: 156000 });
		expect(line.reasons).toEqual(
			expect.arrayContaining(['CAP_EXCEEDED.line', 'CAP_EXCEEDED.order'])
		);
		expect(placed.plan.state).toBe('held');

		const view = must(await h.get_plan(ctx('chef'), { planId: placed.plan.id }));
		expect(view.approval).toMatchObject({ state: 'pending', tier: 'sign_off', lineIds: [line.id] });

		expect(
			must(
				await h.approve(ctx('approver'), {
					approvalId: view.approval!.id,
					planVersion: view.approval!.planVersion,
					termsHash: view.approval!.termsHash,
					decision: 'grant'
				})
			).state
		).toBe('granted');

		const input = {
			planId: placed.plan.id,
			version: view.plan.version,
			idempotencyKey: 's1-commit-1'
		};
		const first = must(await h.commit_order(ctx('chef'), input));
		const retry = must(await h.commit_order(ctx('chef'), input));
		expect(retry.receiptId).toBe(first.receiptId);
		expect(first).toMatchObject({ totalCents: 156000, awaitingSupplier: [] });

		const after = must(await h.get_plan(ctx('chef'), { planId: placed.plan.id }));
		expect(after.plan.state).toBe('committed');
		const orders = await env.ports.store.load('ws-demo', 'run-1');
		expect(Object.keys(orders.orders)).toHaveLength(1);
		expect(published.map((e) => (e.kind === 'op' ? e.envelope.op.type : e.kind))).toEqual([
			'CreatePlan',
			'RecordOffer',
			'RecordApproval',
			'RecordApproval',
			'CommitOrder'
		]);
	});
});

describe('external agent and caps (s5)', () => {
	const basket = [
		{ productId: '464201', qty: 200, unit: 'ST' },
		{ productId: '470418', qty: 10, unit: 'ST' },
		{ productId: '472186', qty: 50, unit: 'ST' }
	];

	it('needs approval, refuses a reused key with another payload, and holds a split order on the weekly cap', async () => {
		// 3,900 € already committed for delivery week 2026-W47.
		await env.ports.store.transact('ws-demo', async (tx) => {
			await env.ports.store.lockBudget(tx, {
				workspaceId: 'ws-demo',
				kitchenId: 'k-lounas',
				week: '2026-W47'
			});
			await env.ports.store.addSpend(
				tx,
				{ workspaceId: 'ws-demo', kitchenId: 'k-lounas', week: '2026-W47' },
				390000
			);
			return { ops: [], value: null };
		});
		const ext = ctx('external_agent');
		const unknown = await h.place_order(ext, {
			kitchenId: 'k-lounas',
			deliverBy: '2026-11-16',
			idempotencyKey: 'x',
			lines: [{ productId: '479999', qty: 1, unit: 'ST' }]
		});
		expect(unknown.ok ? null : unknown.error.code).toBe('NOT_FOUND');

		const a = must(
			await h.place_order(ext, {
				kitchenId: 'k-lounas',
				deliverBy: '2026-11-16',
				idempotencyKey: 'ext-A',
				lines: basket
			})
		);
		expect(a.plan).toMatchObject({ state: 'held', totalCents: 69550 });
		expect(a.plan.lines.every((l) => l.reasons.includes('external_agent_needs_approval'))).toBe(
			true
		);

		const forbidden = await h.approve(ext, {
			approvalId: a.approvalId!,
			planVersion: a.plan.version,
			termsHash: a.plan.termsHash!,
			decision: 'grant'
		});
		expect(forbidden.ok ? null : forbidden.error.code).toBe('FORBIDDEN');
		const early = await h.commit_order(ext, {
			planId: a.plan.id,
			version: a.plan.version,
			idempotencyKey: 'ext-A-commit-early'
		});
		expect(early.ok ? null : early.error.code).toBe('FORBIDDEN');

		must(
			await h.approve(ctx('chef'), {
				approvalId: a.approvalId!,
				planVersion: a.plan.version,
				termsHash: a.plan.termsHash!,
				decision: 'grant'
			})
		);
		const c1 = must(
			await h.commit_order(ext, {
				planId: a.plan.id,
				version: a.plan.version,
				idempotencyKey: 'ext-A-commit'
			})
		);
		const c2 = must(
			await h.commit_order(ext, {
				planId: a.plan.id,
				version: a.plan.version,
				idempotencyKey: 'ext-A-commit'
			})
		);
		expect(c2.receiptId).toBe(c1.receiptId);

		const dup = await h.place_order(ext, {
			kitchenId: 'k-lounas',
			deliverBy: '2026-11-16',
			idempotencyKey: 'ext-A',
			lines: [{ productId: '464201', qty: 300, unit: 'ST' }]
		});
		expect(dup.ok ? null : dup.error.code).toBe('DUPLICATE');

		const b = must(
			await h.place_order(ext, {
				kitchenId: 'k-lounas',
				deliverBy: '2026-11-18',
				idempotencyKey: 'ext-B',
				lines: basket
			})
		);
		expect(b.plan.state).toBe('held');
		expect(b.plan.lines[0].reasons).toContain('CAP_EXCEEDED.weekly');
		expect(b.plan.lines[0].tier).toBe('sign_off');
	});
});

describe('stale approval (s4 mechanics)', () => {
	it('fails the commit with TERMS_CHANGED after a price change and opens a new pending approval', async () => {
		const p = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-11',
				idempotencyKey: 's4-place',
				lines: [{ productId: '462919', qty: 8, unit: 'ST' }]
			})
		);
		expect(p.plan.lines[0]).toMatchObject({ state: 'held' });
		expect(p.plan.lines[0].reasons).toContain('UNKNOWN_REQUIRED');
		must(
			await h.approve(ctx('approver'), {
				approvalId: p.approvalId!,
				planVersion: p.plan.version,
				termsHash: p.plan.termsHash!,
				decision: 'grant'
			})
		);

		env.overlay.setPrice({
			productId: '462919',
			unitCents: 3150,
			label: 'simulated: price update after approval'
		});
		const failed = await h.commit_order(ctx('chef'), {
			planId: p.plan.id,
			version: p.plan.version,
			idempotencyKey: 's4-commit-1'
		});
		expect(failed.ok ? null : failed.error.code).toBe('TERMS_CHANGED');

		const v = must(await h.get_plan(ctx('chef'), { planId: p.plan.id }));
		expect(v.approval).toMatchObject({ state: 'pending' });
		expect(v.plan.lines[0].lineCents).toBe(25200);
		must(
			await h.approve(ctx('approver'), {
				approvalId: v.approval!.id,
				planVersion: v.approval!.planVersion,
				termsHash: v.approval!.termsHash,
				decision: 'grant'
			})
		);
		const ok = must(
			await h.commit_order(ctx('chef'), {
				planId: p.plan.id,
				version: v.plan.version,
				idempotencyKey: 's4-commit-2'
			})
		);
		expect(ok).toMatchObject({ totalCents: 25200, awaitingSupplier: ['462919'] });

		const state = await env.ports.store.load('ws-demo', 'run-1');
		expect(
			Object.values(state.approvals)
				.map((a) => a.state)
				.sort()
		).toEqual(['granted', 'invalidated']);
	});

	it('refuses salmon when only 9 kg are left: below the 10 kg lot', async () => {
		env.overlay.setAvailability({ productId: '462150', amount: 9, label: 'simulated: contention' });
		const p = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-11-16',
				idempotencyKey: 's3-place',
				lines: [{ productId: '462150', qty: 11.53, unit: 'KG' }]
			})
		);
		expect(p.plan.lines[0]).toMatchObject({
			state: 'unorderable',
			reasons: ['BELOW_LOT'],
			qty: { value: 20 }
		});
	});
});
