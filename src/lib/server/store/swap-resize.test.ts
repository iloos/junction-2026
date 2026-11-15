/**
 * A swap buys what the old line delivered, in the new product's packs: 4 cases of 4.32 kg eggs (17.3 kg) become
 * 2 cases of 12.3 kg or 6 cases of 2.88 kg, never 4 of either. A quantity the chef gives wins.
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
const S90 = '467464'; // Kieku irto S90, 4.32 kg a case
const L180 = '463982'; // Kieku L180, 12.3 kg a case
const DAVA = '472106'; // DAVA fried eggs, 2.88 kg a case

let h: ToolHandlers;
let plan: Plan;
beforeEach(async () => {
	const env = await createDbPorts();
	h = createHandlers(env.ports);
	const r = await h.place_order(chef, {
		kitchenId: 'k-hotel',
		deliverBy: '2026-12-11',
		idempotencyKey: 'eggs',
		lines: [{ productId: S90, qty: 4, unit: 'KI' }]
	});
	if (!r.ok) throw new Error(r.error.message);
	plan = r.value.plan;
});

const swap = async (productId: string, qty?: number) => {
	const r = await h.edit_line(chef, {
		planId: plan.id,
		version: plan.version,
		lineId: plan.lines[0].id,
		patch: { productId, ...(qty !== undefined ? { qty } : {}) }
	});
	if (!r.ok) throw new Error(r.error.message);
	return r.value.plan.lines.find((l) => l.productId === productId)!;
};

describe('a swap re-sizes to what the old line delivered', () => {
	it('bigger packs: 17.3 kg is 2 cases of 12.3 kg', async () => {
		expect((await swap(L180)).qty).toMatchObject({ value: 2, unit: 'KI' });
	});
	it('smaller packs: 17.28 kg is 6 cases of 2.88 kg', async () => {
		expect((await swap(DAVA)).qty).toMatchObject({ value: 6, unit: 'KI' });
	});
	it("the chef's own quantity wins", async () => {
		expect((await swap(L180, 3)).qty).toMatchObject({ value: 3, unit: 'KI' });
	});
});
