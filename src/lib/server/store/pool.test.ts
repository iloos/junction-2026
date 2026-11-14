/** Prod rehearsal: a dish the event seed knows is rescued only from its own candidates and Valio's rules. */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Weights } from '$lib/core/contracts';
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
const PRICE_FIRST: Weights = { price: 0.7, reliability: 0.3, finnish: 0, carbon: 0, organic: 0 };
const GRAHAM_PIE = '461282';
const PORK_KIDNEY = '462425';

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

async function substitutesFor(productId: string, weights?: Weights) {
	const { plan } = must(
		await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
	);
	const cur = must(await h.get_plan(chef, { planId: plan.id })).plan;
	const line = cur.lines.find((l) => l.productId === productId)!;
	return must(
		await h.find_substitutes(chef, {
			planId: cur.id,
			version: cur.version,
			lineId: line.id,
			...(weights ? { weights } : {})
		})
	);
}

describe('substitute pool for a seeded dish', () => {
	it('never offers a graham pie for swede casserole, even with the seed candidate gone', async () => {
		env.overlay.setAvailability({ productId: '462157', amount: 0, label: 'simulated: taken' });
		for (const w of [undefined, PRICE_FIRST]) {
			const r = await substitutesFor('462482', w);
			expect(r.candidates.map((c) => c.productId)).not.toContain(GRAHAM_PIE);
			// The seed candidate is gone, so the seed's own answer (make it in house) is what's left.
			expect(r.kind).toBe('make_in_house');
		}
	});

	it('never offers pork kidney for the Christmas ham under price-first', async () => {
		const r = await substitutesFor('462490', PRICE_FIRST);
		expect(r.candidates.map((c) => c.productId)).not.toContain(PORK_KIDNEY);
		expect(r.chosen[0]?.productName).toMatch(/kinkku/i);
	});

	it('D8: recommends making swede casserole in house over a product of unknown supply, which stays ranked below', async () => {
		for (const w of [undefined, PRICE_FIRST]) {
			const r = await substitutesFor('462482', w);
			expect(r.kind).toBe('make_in_house');
			const terminal = r.candidates.find((c) => c.productId === '462157');
			expect(terminal?.rank).not.toBeNull(); // still visible and rankable
			expect(r.chosen.map((l) => l.productId)).not.toContain('462157');
		}
	});

	it('D8: the ham keeps its confirmed Stock replacement first', async () => {
		const r = await substitutesFor('462490');
		expect(r.kind).toBe('product');
		expect(r.chosen[0]?.productId).toBe('476768');
	});
});
