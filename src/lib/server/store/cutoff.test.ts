/** F9 / F29: an offer's cut-off on the scenario clock closes ordering, at commit and in the view. */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
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
const MILK = '464201'; // k-hotel's usual product, Stock: cut-off D-1 at Valio's 17:00
const CUTOFF = '2026-12-09T17:00:00+02:00'; // for delivery on 10 Dec

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
const setNow = (iso: string) => (env.ports.clock = { now: () => new Date(iso) });
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
	setNow('2026-12-07T21:40:00+02:00');
});

async function placed(key: string) {
	const { plan } = must(
		await h.place_order(ctx('kitchen_agent'), {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-10',
			idempotencyKey: key,
			lines: [{ productId: MILK, qty: 10, unit: 'ST' }]
		})
	);
	expect(plan.lines[0].offer?.availability.closingTime).toBe(CUTOFF);
	expect(plan.lines[0]).toMatchObject({ state: 'eligible', tier: 'act' });
	return plan;
}
const commit = (planId: string, version: number, key: string) =>
	h.commit_order(ctx('kitchen_agent'), { planId, version, idempotencyKey: key });

describe('cut-off at commit', () => {
	it('commits a minute before the cut-off', async () => {
		const plan = await placed('before');
		setNow('2026-12-09T16:59:00+02:00');
		expect(must(await commit(plan.id, plan.version, 'c-before')).committedLineIds).toHaveLength(1);
	});

	for (const [when, at] of [
		['at', CUTOFF],
		['after', '2026-12-09T18:30:00+02:00']
	] as const)
		it(`refuses ${when} the cut-off, names the line, and the plan shows it closed`, async () => {
			const plan = await placed(when);
			setNow(at);
			// The view already says so before anyone tries (F29).
			const shown = must(await h.get_plan(ctx('chef'), { planId: plan.id })).plan.lines[0].view!;
			expect(shown).toMatchObject({
				committable: false,
				blockedReason: { code: 'cutoff_passed' },
				nextAction: 'find_substitute'
			});
			const r = await commit(plan.id, plan.version, `c-${when}`);
			expect(r.ok ? null : r.error).toMatchObject({
				code: 'FORBIDDEN',
				sub: 'cutoff',
				detail: { lineIds: [plan.lines[0].id] }
			});
			const now = must(await h.get_plan(ctx('chef'), { planId: plan.id })).plan;
			expect(now.lines[0]).toMatchObject({ state: 'unorderable', reasons: ['cutoff_passed'] });
			expect(now.view!.validUntil).toBeUndefined();
		});

	it('a held line whose grant expired is not committable until approved again', async () => {
		const { plan, approvalId } = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-20', // its cut-off is well after the approval expires
				idempotencyKey: 'expiring',
				lines: [{ productId: '472817', qty: 1, unit: 'KI' }]
			})
		);
		const a = must(await h.get_plan(ctx('chef'), { planId: plan.id })).approval!;
		must(
			await h.approve(ctx('approver'), {
				approvalId: approvalId!,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			})
		);
		expect(
			must(await h.get_plan(ctx('chef'), { planId: plan.id })).plan.lines[0].view!.committable
		).toBe(true);
		setNow(new Date(new Date(a.expiresAt!).getTime() + 1000).toISOString());
		const v = must(await h.get_plan(ctx('chef'), { planId: plan.id })).plan.lines[0].view!;
		expect(v).toMatchObject({ committable: false, nextAction: 'approve' });
	});
});
