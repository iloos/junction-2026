/** Every line a tool returns says what can be done with it, decided by the server. */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const at = (plan: Plan, productId: string) => plan.lines.find((l) => l.productId === productId)!;

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

describe('LineView on tool outputs', () => {
	it('follows a plan from outage to rescue to approval to commit', async () => {
		let { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		expect(plan.lines.every((l) => l.view)).toBe(true);
		expect(at(plan, '462490').view).toMatchObject({
			blockedReason: { code: 'out', effect: 'forbid', detail: 'stock' },
			nextAction: 'find_substitute',
			committable: false
		});
		expect(at(plan, '463860').view).toMatchObject({
			reviewable: true,
			committable: false,
			unknownStockCover: { value: 6, unit: 'pcs' },
			knownStockCover: { value: 0 },
			nextAction: 'approve'
		});
		// Salmon is in the hotel's standing-order baseline, so it is not a new product: inside the mandate it needs
		// no sign-off and goes straight to commit.
		expect(at(plan, '462150').view).toMatchObject({
			knownStockCover: { value: 20, unit: 'kg' },
			nextAction: 'commit'
		});

		const ham = at(plan, '462490');
		plan = must(
			await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: ham.id })
		).plan;
		expect(at(plan, '462490').view?.nextAction).toBe('none'); // replaced

		const v = must(await h.get_plan(chef, { planId: plan.id }));
		expect(v.approval).toMatchObject({
			mandateVersion: 1,
			requestedBy: { kind: 'chef' },
			expiresAt: expect.stringMatching(/^2026-12-/)
		});
		must(
			await h.approve(chef, {
				approvalId: v.approval!.id,
				planVersion: v.approval!.planVersion,
				termsHash: v.approval!.termsHash,
				decision: 'grant'
			})
		);
		const approved = must(await h.get_plan(chef, { planId: plan.id })).plan;
		expect(at(approved, '463860').view).toMatchObject({ committable: true, nextAction: 'commit' });
		expect(must(await h.get_plan(chef, { planId: plan.id })).approval?.decidedBy).toMatchObject({
			kind: 'chef'
		});

		must(
			await h.commit_order(chef, { planId: plan.id, version: plan.version, idempotencyKey: 'v1' })
		);
		const done = must(await h.get_plan(chef, { planId: plan.id })).plan;
		expect(at(done, '463860').view).toMatchObject({
			nextAction: 'wait_for_supplier',
			unknownStockCover: { value: 6 }
		});
		expect(at(done, '462150').view).toMatchObject({
			nextAction: 'none',
			knownStockCover: { value: 20 }
		});
	});

	it('names a missing price as a gap to re-quote, not something to approve', async () => {
		env.overlay.setPriceMissing('470418', 'simulated: no price');
		const p = must(
			await h.place_order(chef, {
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-10',
				idempotencyKey: 'gap',
				lines: [{ productId: '470418', qty: 1, unit: 'ST' }]
			})
		);
		expect(p.plan.lines[0].view).toMatchObject({
			reviewable: false,
			committable: false,
			blockedReason: { code: 'price_missing', effect: 'gap', detail: 'price' },
			nextAction: 'requote'
		});
	});
});
