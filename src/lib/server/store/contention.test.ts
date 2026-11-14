/**
 * Contention re-rescue: another kitchen takes 4 palvikinkku. The agent keeps the 11 left and sizes the next eligible
 * candidate to the rest of the ham need on the served basis; the earlier approval voids with its diff; nothing commits;
 * Ops gets a contention anomaly.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { rescueContention } from '$lib/core/services/contention';
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
const PALVI = '476768';
const HAM = '462490';

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

/** Christmas plan, ham rescued to 13 palvikinkku, and every pending approval granted. */
async function approvedRescue(): Promise<Plan> {
	const { plan } = must(
		await h.plan_event(ctx('chef'), { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	);
	const ham = plan.lines.find((l) => l.productId === HAM)!;
	must(
		await h.find_substitutes(ctx('chef'), {
			planId: plan.id,
			version: plan.version,
			lineId: ham.id
		})
	);
	const got = must(await h.get_plan(ctx('chef'), { planId: plan.id }));
	if (got.approval?.state === 'pending')
		must(
			await h.approve(ctx('chef'), {
				approvalId: got.approval.id,
				planVersion: got.plan.version,
				termsHash: got.plan.termsHash!,
				decision: 'grant'
			})
		);
	const after = must(await h.get_plan(ctx('chef'), { planId: plan.id }));
	expect(after.plan.lines.find((l) => l.productId === PALVI)?.qty.value).toBe(13);
	return after.plan;
}

describe('another kitchen takes 4 palvikinkku', () => {
	it('keeps the 11 left, covers the rest with the next candidate, voids the approval, commits nothing', async () => {
		const before = await approvedRescue();
		const granted = must(await h.get_plan(ctx('chef'), { planId: before.id })).approval;
		env.overlay.setAvailability({
			productId: PALVI,
			amount: 11,
			label: 'simulated: another kitchen took 4'
		});

		const r = must(
			await rescueContention(env.ports, ctx('kitchen_agent'), {
				productId: PALVI,
				note: 'another kitchen took 4 × 476768',
				ref: 'sim-contention-1'
			})
		);
		expect(r.rescued).toHaveLength(1);
		const [x] = r.rescued;
		expect(x).toMatchObject({ left: 11, had: 13 });
		const kept = x.chosen.find((l) => l.productId === PALVI)!;
		const added = x.chosen.find((l) => l.productId !== PALVI)!;
		expect(kept.qty.value).toBe(11);
		expect(added.substituteFor).toBe(HAM);
		expect(added.provenance.note).toContain('another kitchen took 4');

		const now = must(await h.get_plan(ctx('chef'), { planId: before.id }));
		// The split covers the ham need on the served basis, with less than one unit of the new product to spare.
		const f = now.plan.view!.fulfilment.find((v) => v.needId === kept.needId)!;
		expect(f.basis).toBe('served');
		const planned = f.plannedKnown.value + f.plannedUnknown.value;
		expect(planned).toBeGreaterThanOrEqual(f.required.value - 1e-6);
		expect(['planned', 'confirmed', 'awaiting_supplier']).toContain(f.status);

		expect(f.excess.value).toBeLessThan(1.8); // under one 1.8 kg lot of the new product
		// The new product breaks "meat: Finnish preferred": held in a sign-off group, not bought on the agent's word.
		const newLine = now.plan.lines.find((l) => l.id === added.id)!;
		expect(newLine).toMatchObject({ state: 'held', tier: 'sign_off' });
		expect(newLine.reasons).toContain('substitute_breaks_preference');
		expect(now.approval?.state).toBe('pending');
		// The earlier approval voided, with the diff; nothing is committed.
		expect(granted?.state).toBe('granted');
		expect(now.lastVoided).toMatchObject({ approvalId: granted!.id });
		expect(now.lastVoided!.diff).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					productId: PALVI,
					change: 'qty',
					before: '13 ST',
					after: '11 ST'
				}),
				expect.objectContaining({ productId: added.productId, change: 'added' })
			])
		);
		expect(now.plan.lines.some((l) => l.state === 'committed')).toBe(false);

		const state = await env.ports.store.load('ws-demo', 'run-1');
		expect(Object.values(state.anomalies ?? {}).map((a) => a.kind)).toContain('contention');
		expect(state.plans[before.id].state).not.toBe('committed');
	});

	it('does nothing while the supplier still has enough', async () => {
		await approvedRescue();
		env.overlay.setAvailability({ productId: PALVI, amount: 13, label: 'enough' });
		const r = must(
			await rescueContention(env.ports, ctx('kitchen_agent'), { productId: PALVI, note: 'x' })
		);
		expect(r.rescued).toEqual([]);
	});
});
