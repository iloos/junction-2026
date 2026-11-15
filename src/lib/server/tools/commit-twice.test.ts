/**
 * P0 (15 Nov): after "Order 3 lines now", committing the signed-off rest did nothing. Neither a commit nor a grant
 * bumps the plan version, so the kitchen's key (plan + version) repeated and the first receipt was replayed. Core's
 * contract: the same key is the same command (replayed), a new key after progress is a new order.
 */
import { describe, expect, it } from 'vitest';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';

describe('two commits on one plan', () => {
	it(
		'commit the in-mandate lines, sign off the rest, commit again: a second receipt',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			w.env.ports.clock = { now: () => FIDELITY_NOW };
			const chef = w.ctx('chef');
			const planned = await w.handlers.plan_event(chef, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const planId = planned.value.plan.id;
			const read = async () => {
				const g = await w.handlers.get_plan(chef, { planId });
				if (!g.ok) throw new Error(g.error.message);
				return g.value;
			};
			let v = await read();
			const first = await w.handlers.commit_order(chef, {
				planId,
				version: v.plan.version,
				idempotencyKey: 'press-1'
			});
			if (!first.ok) throw new Error(first.error.message);
			expect(first.value.committedLineIds.length).toBeGreaterThan(0);

			v = await read();
			expect(v.approval?.state).toBe('pending');
			const granted = await w.handlers.approve(w.ctx('approver'), {
				approvalId: v.approval!.id,
				planVersion: v.approval!.planVersion,
				termsHash: v.approval!.termsHash,
				decision: 'grant'
			});
			expect(granted.ok).toBe(true);
			v = await read();

			// The same key is the same command: the first receipt again, nothing bought.
			const again = await w.handlers.commit_order(chef, {
				planId,
				version: v.plan.version,
				idempotencyKey: 'press-1'
			});
			expect(again.ok && again.value.receiptId).toBe(first.value.receiptId);

			// A new key after the grant is a new order with the signed-off lines.
			const second = await w.handlers.commit_order(chef, {
				planId,
				version: v.plan.version,
				idempotencyKey: 'press-2'
			});
			if (!second.ok) throw new Error(second.error.message);
			expect(second.value.receiptId).not.toBe(first.value.receiptId);
			expect(second.value.committedLineIds.length).toBeGreaterThan(0);
			expect(
				second.value.committedLineIds.some((id) => first.value.committedLineIds.includes(id))
			).toBe(false);
		}
	);
});
