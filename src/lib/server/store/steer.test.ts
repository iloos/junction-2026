/**
 * D28: the chef steers the alternatives. Each chip re-runs the search for this call only (a preview), the pick plus up
 * to four alternatives come back with one reason, supply, a price per kg or l and the total for the need.
 */
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
const HAM = '462490';

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
let plan: Plan;
let lineId: string;
beforeEach(async () => {
	env = await createDbPorts();
	h = createHandlers(env.ports);
	const r = await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
	if (!r.ok) throw new Error(r.error.message);
	plan = r.value.plan;
	lineId = plan.lines.find((l) => l.productId === HAM)!.id;
});

const steer = async (s: Record<string, unknown>) => {
	const r = await h.find_substitutes(chef, {
		planId: plan.id,
		version: plan.version,
		lineId,
		steer: s as never
	});
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
};

describe('find_substitutes steer (D28)', () => {
	it('returns alternatives with a reason, supply, price per unit and the total for the need, as a preview', async () => {
		const out = await steer({});
		expect(out.applied).toBe(false);
		expect(out.alternatives!.length).toBeGreaterThan(0);
		expect(out.alternatives!.length).toBeLessThanOrEqual(4);
		for (const a of out.alternatives!) {
			expect(a.reason.length).toBeGreaterThan(2);
			expect(a.supply).toBeTruthy();
			if (a.qty) expect(a.qty.value).toBeGreaterThan(0);
		}
		expect(out.alternatives!.some((a) => a.totalCents !== undefined)).toBe(true);
		// The agent's pick has its total too, and is not repeated among the alternatives.
		expect(out.pick?.totalCents).toBeGreaterThan(0);
		expect(out.alternatives!.map((a) => a.productId)).not.toContain(out.pick!.productId);
	});

	it('same brand keeps the planned brand; bigger pack keeps bigger packs', async () => {
		const products = await env.ports.catalog.get([HAM]);
		const planned = products.get(HAM)!;
		const brand = await steer({ sameBrand: true });
		const ids = brand.candidates.filter((c) => c.rank !== null).map((c) => c.productId);
		expect(ids.length).toBeGreaterThan(0);
		expect(brand.alternatives?.[0]?.reason).toMatch(/same brand/);
		const got = await env.ports.catalog.get(ids);
		for (const p of got.values()) expect(p.brand).toBe(planned.brand);

		const bigger = await steer({ pack: 'bigger' });
		const bigIds = bigger.candidates.filter((c) => c.rank !== null).map((c) => c.productId);
		const big = await env.ports.catalog.get(bigIds);
		for (const p of big.values())
			expect(p.netPerSalesUnit!.value.value).toBeGreaterThan(planned.netPerSalesUnit!.value.value);
	});

	it("the chef's words and another kind widen the search; organic only keeps organic", async () => {
		const words = await steer({ text: 'lohi', differentKind: true });
		const names = words.candidates.map((c) => (c.productName ?? '').toLowerCase());
		expect(names.some((n) => n.includes('lohi'))).toBe(true);
		// Only what the words found says it matches them.
		for (const a of words.alternatives ?? [])
			if (a.reason.startsWith('matches'))
				expect((a.productName ?? '').toLowerCase()).toContain('lohi');

		const organic = await steer({ organic: true });
		const ranked = organic.candidates.filter((c) => c.rank !== null).map((c) => c.productId);
		const got = await env.ports.catalog.get(ranked);
		for (const p of got.values())
			expect(p.labels.includes('EU_ORGANIC_FARMING') || /luomu/i.test(p.nameFi)).toBe(true);
	});
});
