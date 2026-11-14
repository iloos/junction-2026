/** Web lane Need 1: a recall notice holds the product's open lines for a human and steers to a substitute. */
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
const at = (p: Plan, id: string) => p.lines.find((l) => l.productId === id)!;

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

/** What the web lane's recall ingest writes: one RecordAnomaly through the store. */
async function recall(productId: string) {
	const r = await env.ports.store.transact('ws-demo', async () => ({
		ops: [
			{
				workspaceId: 'ws-demo',
				runId: 'run-1',
				actor: { kind: 'system' as const, id: 'recall-watch' },
				via: 'test:recall',
				op: {
					type: 'RecordAnomaly' as const,
					anomaly: {
						workspaceId: 'ws-demo',
						runId: 'run-1',
						id: `recall-${productId}`,
						kind: 'recall' as const,
						productId,
						message: `Ruokavirasto recall notice names ${productId} (simulated)`,
						detectedAt: '2026-12-07T22:00:00+02:00',
						provenance: { source: 'simulator' as const, note: 'replayed recall notice' }
					}
				}
			}
		],
		value: null
	}));
	if (!r.ok) throw new Error(r.error.message);
}

describe('recall', () => {
	it('holds the line for sign-off, voids its approval, survives a re-quote and points at a substitute', async () => {
		let { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const before = must(await h.get_plan(chef, { planId: plan.id }));
		expect(before.approval?.state).toBe('pending');

		await recall('462150');
		const after = must(await h.get_plan(chef, { planId: plan.id }));
		const salmon = at(after.plan, '462150');
		expect(salmon).toMatchObject({ state: 'held', tier: 'sign_off' });
		expect(salmon.reasons).toContain('recall');
		expect(salmon.view).toMatchObject({ reviewable: true, nextAction: 'find_substitute' });
		expect(after.plan.version).toBe(plan.version + 1);
		expect(after.approval?.id).not.toBe(before.approval?.id); // the old one was voided

		// A later re-quote (an unrelated edit) keeps the recall hold.
		plan = must(
			await h.edit_line(chef, {
				planId: after.plan.id,
				version: after.plan.version,
				needId: 'need:joulukinkku',
				patch: { gramsPerGuest: 120 }
			})
		).plan;
		expect(at(plan, '462150').reasons).toContain('recall');
	});

	it('never recommends a recalled product as a substitute', async () => {
		env.overlay.setAvailability({ productId: '462150', amount: 9, label: 'simulated: contention' });
		await recall('462016'); // the Finnish trout that would otherwise rank first
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const salmon = at(plan, '462150');
		const r = must(
			await h.find_substitutes(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: salmon.id
			})
		);
		const trout = r.candidates.find((c) => c.productId === '462016');
		expect(trout?.rank).toBeNull();
		expect(trout?.rejectedReasons).toContain('recall');
		expect(r.chosen.map((l) => l.productId)).not.toContain('462016');
	});
});
