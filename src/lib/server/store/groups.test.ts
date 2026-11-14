/** Ruling 6 / F13: approve{lineIds} decides one reason group at a time; a grant never covers a line it did not list. */
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
const chef = ctx('chef');
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	// Valio states no stock for this milk (≥999999 = unknown); these tests need a product in known stock.
	env.overlay.setAvailability({ productId: '464201', amount: 5000, label: 'test: known stock' });
	// One herring in known stock, so a group held only as a new product (no UNKNOWN_REQUIRED) exists.
	env.overlay.setAvailability({ productId: '463876', amount: 50, label: 'test: known stock' });
	h = createHandlers(env.ports);
});

/** Christmas with the tarts made in house: held lines for an allergen change, unknown supply and new products. */
async function heldPlan() {
	let plan = must(
		await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	).plan;
	const tart = plan.lines.find((l) => l.productId === '473317')!;
	plan = must(
		await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: tart.id })
	).plan;
	const view = must(await h.get_plan(chef, { planId: plan.id }));
	const a = view.approval!;
	const byId = new Map(view.plan.lines.map((l) => [l.id, l]));
	const group = (pred: (r: string[]) => boolean) =>
		a.lineIds.filter((id) => pred(byId.get(id)!.reasons));
	const allergen = group((r) => r.includes('allergen_change'));
	const unknown = group((r) => !r.includes('allergen_change') && r.includes('UNKNOWN_REQUIRED'));
	const rest = a.lineIds.filter((id) => !allergen.includes(id) && !unknown.includes(id));
	expect(allergen.length).toBeGreaterThan(0);
	expect(unknown.length).toBeGreaterThan(0);
	expect(rest.length).toBeGreaterThan(0);
	return { plan: view.plan, a, allergen, unknown, rest };
}

const decide = (
	a: { id: string; planVersion: number; termsHash: string },
	decision: 'grant' | 'deny',
	lineIds?: string[]
) =>
	h.approve(ctx('approver'), {
		approvalId: a.id,
		planVersion: a.planVersion,
		termsHash: a.termsHash,
		decision,
		...(lineIds ? { lineIds } : {})
	});

describe('per-group approval', () => {
	it('grant one group, deny another, grant the rest: the commit buys the granted groups only', async () => {
		const { plan, a, allergen, unknown, rest } = await heldPlan();

		const g1 = must(await decide(a, 'grant', allergen));
		expect(g1.state).toBe('granted');
		const r1 = { ...a, id: g1.remainingApprovalId! };
		expect(r1.id).toBeTruthy();

		const g2 = must(await decide(r1, 'deny', unknown));
		expect(g2.state).toBe('denied');
		const r2 = { ...a, id: g2.remainingApprovalId! };
		const g3 = must(await decide(r2, 'grant'));
		expect(g3).toMatchObject({ state: 'granted' });

		const now = must(await h.get_plan(chef, { planId: plan.id })).plan;
		const view = new Map(now.lines.map((l) => [l.id, l.view!]));
		for (const id of [...allergen, ...rest]) expect(view.get(id)!.committable).toBe(true);
		for (const id of unknown)
			expect(view.get(id)).toMatchObject({ committable: false, reviewable: false });

		// A denied line can't be bought, even named explicitly.
		const denied = await h.commit_order(chef, {
			planId: plan.id,
			version: now.version,
			idempotencyKey: 'denied-line',
			lineIds: [unknown[0]]
		});
		expect(denied.ok ? null : denied.error.code).toBe('FORBIDDEN');

		const c = must(
			await h.commit_order(chef, {
				planId: plan.id,
				version: now.version,
				idempotencyKey: 'groups'
			})
		);
		for (const id of unknown) expect(c.committedLineIds).not.toContain(id);
		for (const id of [...allergen, ...rest]) expect(c.committedLineIds).toContain(id);
		const order = (await env.ports.store.load('ws-demo', 'run-1')).orders[c.orderId];
		const auth = new Map(order.lines.map((l) => [l.lineId, l.authority]));
		for (const id of allergen) expect(auth.get(id)).toEqual({ approvalId: a.id });
		for (const id of rest) expect(auth.get(id)).toEqual({ approvalId: r2.id });
	});

	it('refuses a group with a line the approval never listed; an edit voids every group', async () => {
		const { plan, a, allergen } = await heldPlan();
		const act = plan.lines.find((l) => l.state === 'eligible')!;
		const bad = await decide(a, 'grant', [allergen[0], act.id]);
		expect(bad.ok ? null : bad.error.code).toBe('INVALID_INPUT');

		must(await decide(a, 'grant', allergen));
		const line = plan.lines.find((l) => l.id === allergen[0])!;
		const edited = must(
			await h.edit_line(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: line.id,
				patch: { qty: line.qty.value + 1 }
			})
		).plan;
		const state = await env.ports.store.load('ws-demo', 'run-1');
		const live = Object.values(state.approvals).filter(
			(x) => x.planId === plan.id && x.planVersion < edited.version
		);
		expect(live.every((x) => x.state === 'invalidated' || x.state === 'denied')).toBe(true);
		const v = edited.lines.find((l) => l.id === line.id)!.view!;
		expect(v.committable).toBe(false);

		// The voided approval says what changed since it was shown (before → after).
		const got = must(await h.get_plan(chef, { planId: plan.id }));
		expect(got.lastVoided?.approvalId.startsWith(a.id)).toBe(true); // either group of the split approval
		expect(got.lastVoided?.diff).toContainEqual(
			expect.objectContaining({
				lineId: line.id,
				change: 'qty',
				before: `${line.qty.value} ${line.qty.unit}`,
				after: `${line.qty.value + 1} ${line.qty.unit}`
			})
		);
	});
});
