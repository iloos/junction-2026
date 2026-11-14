/**
 * D24/D25/D26: a visitor makes their own kitchen, copied from a sample or blank. Only its owner can write to it (the
 * gate refuses anyone else, and any door that did not say which visitor it is); everyone can read it; a shortage
 * re-plans it like any other kitchen; and it survives a new run.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { BLANK_MANDATE } from '$lib/core/services/kitchens';
import { replanShortage } from '$lib/core/services/shortage';
import { createDbPorts, loadSeedKitchens } from './db-ports';

const WS = 'ws-demo';
const ctx = (kind: keyof typeof SCOPES_BY_ACTOR, visitor?: string): CallContext => ({
	workspaceId: WS,
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test',
	...(visitor ? { visitor } : {})
});
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const MILK = '464201';
const order = (h: ToolHandlers, c: CallContext, kitchenId: string, key: string) =>
	h.place_order(c, {
		kitchenId,
		deliverBy: '2026-12-11',
		idempotencyKey: key,
		lines: [{ productId: MILK, qty: 10, unit: 'ST', amount: { value: 10, unit: 'l' } }]
	});

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

describe('create_kitchen', () => {
	it('copies a sample (rules, usual order) or makes a blank one, owned by the visitor', async () => {
		const { kitchen: copied } = must(
			await h.create_kitchen(ctx('chef', 'vis-a'), {
				name: 'Anna’s Lunch',
				profile: 'lunch_restaurant'
			})
		);
		expect(copied.copiedFrom).toBe('k-lounas');
		expect(copied.kitchenId).toMatch(/^k-v-/);
		const all = await env.ports.store.kitchens(WS);
		const k = all.find((x) => x.id === copied.kitchenId)!;
		const lounas = all.find((x) => x.id === 'k-lounas')!;
		expect(k.owner).toBe('vis-a');
		expect(k.mandate.lineCapCents).toBe(lounas.mandate.lineCapCents);
		expect(k.deliveryDays).toEqual(lounas.deliveryDays);
		// Copied, not linked: the sample is unchanged and unowned.
		expect(lounas.owner).toBeUndefined();

		const { kitchen: blank } = must(
			await h.create_kitchen(ctx('chef', 'vis-a'), { name: 'Pop-up', description: 'Street food' })
		);
		expect(blank.copiedFrom).toBe('');
		const b = (await env.ports.store.kitchens(WS)).find((x) => x.id === blank.kitchenId)!;
		expect(b.kind).toBe('blank');
		expect(b.mandate).toEqual(BLANK_MANDATE);
		expect(b.usualProducts).toEqual([]);
		expect(b.description).toBe('Street food');
	});

	it('only the owner writes to a store; no visitor fails closed; reads and seeded kitchens stay open', async () => {
		const a = ctx('chef', 'vis-a');
		const b = ctx('chef', 'vis-b');
		const { kitchen: ka } = must(await h.create_kitchen(a, { name: 'A', profile: 'cafe' }));
		const { kitchen: kb } = must(await h.create_kitchen(b, { name: 'B', profile: 'cafe' }));

		const planA = must(await order(h, a, ka.kitchenId, 'a-1')).plan;
		must(await order(h, b, kb.kitchenId, 'b-1'));

		const theirs = await order(h, b, ka.kitchenId, 'b-2');
		expect(theirs.ok).toBe(false);
		if (!theirs.ok) {
			expect(theirs.error.code).toBe('FORBIDDEN');
			expect(theirs.error.sub).toBe('store_owner');
		}
		// Through the plan: an edit names only the plan, and still lands on A's store.
		const line = planA.lines[0];
		const edit = await h.edit_line(b, {
			planId: planA.id,
			version: planA.version,
			lineId: line.id,
			patch: { qty: 1 }
		});
		expect(!edit.ok && edit.error.sub).toBe('store_owner');
		// A door that did not thread the visitor (chat, an outside agent) is refused, not let through.
		const anon = await order(h, ctx('chef'), ka.kitchenId, 'anon-1');
		expect(!anon.ok && anon.error.sub).toBe('store_owner');
		const agent = await order(h, ctx('external_agent'), ka.kitchenId, 'ext-1');
		expect(!agent.ok && agent.error.sub).toBe('store_owner');
		// Reads stay open: the room watches every store.
		expect((await h.get_plan(b, { planId: planA.id })).ok).toBe(true);
		// Seeded kitchens (no owner) are unchanged for everyone.
		must(await order(h, b, 'k-hotel', 'b-hotel'));
		must(await order(h, ctx('chef'), 'k-hotel', 'anon-hotel'));
		// Making a store needs a visitor too.
		const nobody = await h.create_kitchen(ctx('external_agent'), { name: 'X' });
		expect(!nobody.ok && nobody.error.sub).toBe('store_owner');
	});

	it('a shortage re-plans both visitors’ stores', async () => {
		const a = ctx('chef', 'vis-a');
		const b = ctx('chef', 'vis-b');
		const { kitchen: ka } = must(
			await h.create_kitchen(a, { name: 'A', profile: 'lunch_restaurant' })
		);
		const { kitchen: kb } = must(await h.create_kitchen(b, { name: 'B', profile: 'city_hotel' }));
		must(await order(h, a, ka.kitchenId, 'a-1'));
		must(await order(h, b, kb.kitchenId, 'b-1'));
		env.overlay.setAvailability({ productId: MILK, amount: 4, label: 'simulated shortage' });
		env.overlay.setAvailability({ productId: '464119', amount: 500, label: 'simulated stock' });
		const r = must(
			await replanShortage(env.ports, ctx('kitchen_agent'), {
				productId: MILK,
				had: 30,
				left: 4,
				shortageId: 'sh-1',
				note: 'Valio is short'
			})
		);
		const out = Object.fromEntries(r.kitchens.map((k) => [k.kitchenId, k.outcome]));
		expect(out[ka.kitchenId]).not.toBe('unaffected');
		expect(out[kb.kitchenId]).not.toBe('unaffected');
	});

	it('D26: a visitor’s store survives a new run with the same owner', async () => {
		const { kitchen } = must(
			await h.create_kitchen(ctx('chef', 'vis-a'), { name: 'Keeps', profile: 'cafe' })
		);
		// A reset starts a new run and re-seeds the sample kitchens only.
		await env.store.ensure({
			workspaceId: WS,
			runId: 'run-2',
			kitchens: loadSeedKitchens(),
			simStart: '2026-12-07T21:40:00+02:00'
		});
		const k = (await env.ports.store.kitchens(WS)).find((x) => x.id === kitchen.kitchenId);
		expect(k?.owner).toBe('vis-a');
		expect(k?.name).toBe('Keeps');
	});
});
