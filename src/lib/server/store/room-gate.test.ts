/**
 * D24 room policy: in the shared room a visitor writes only to a store they made. The seeded room kitchens are
 * read-only for visitors, another visitor's store is theirs alone, and the presenter keeps full access.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const WS = 'ws-judges';
const room = (visitor: string | undefined, presenter = false): CallContext => ({
	workspaceId: WS,
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-ui' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'kitchen',
	...(visitor ? { visitor } : {}),
	sharedRoom: !presenter
});
const order = (h: ToolHandlers, c: CallContext, kitchenId: string, key: string) =>
	h.place_order(c, {
		kitchenId,
		deliverBy: '2026-12-11',
		idempotencyKey: key,
		lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
	});

let h: ToolHandlers;
beforeEach(async () => {
	const env = await createDbPorts({ workspaceId: WS, runId: 'run-1' });
	h = createHandlers(env.ports);
});

describe('the shared room', () => {
	it('a visitor orders for their own store only, never the hotel or another store', async () => {
		const a = room('vis-a');
		const b = room('vis-b');
		const ka = await h.create_kitchen(a, { name: 'A', profile: 'cafe' });
		const kb = await h.create_kitchen(b, { name: 'B', profile: 'cafe' });
		if (!ka.ok || !kb.ok) throw new Error('create');
		const mine = await order(h, a, ka.value.kitchen.kitchenId, 'a-own');
		expect(mine.ok).toBe(true);

		const hotel = await order(h, a, 'k-hotel', 'a-hotel');
		expect(!hotel.ok && hotel.error).toMatchObject({ code: 'FORBIDDEN', sub: 'room_store' });
		expect(!hotel.ok && hotel.error.message).toMatch(/Join the room as your own store/);

		const theirs = await order(h, a, kb.value.kitchen.kitchenId, 'a-b');
		expect(!theirs.ok && theirs.error.code).toBe('FORBIDDEN');

		// Deciding B's plan (approve names the approval, which names B's plan) is refused too.
		const bPlan = await order(h, b, kb.value.kitchen.kitchenId, 'b-own');
		if (!bPlan.ok) throw new Error(bPlan.error.message);
		if (bPlan.value.approvalId) {
			const decide = await h.approve(a, {
				approvalId: bPlan.value.approvalId,
				planVersion: bPlan.value.plan.version,
				termsHash: bPlan.value.plan.termsHash!,
				decision: 'grant'
			});
			expect(!decide.ok && decide.error.code).toBe('FORBIDDEN');
		}
		const edit = await h.edit_line(a, {
			planId: bPlan.value.plan.id,
			version: bPlan.value.plan.version,
			lineId: bPlan.value.plan.lines[0].id,
			patch: { qty: 1 }
		});
		expect(!edit.ok && edit.error.code).toBe('FORBIDDEN');

		// Reads stay open: the room watches every store.
		expect((await h.get_plan(a, { planId: bPlan.value.plan.id })).ok).toBe(true);
	});

	it('a door without a visitor is refused; the presenter keeps the seeded kitchens', async () => {
		const anon = await order(h, room(undefined), 'k-hotel', 'anon');
		expect(!anon.ok && anon.error.sub).toBe('room_store');
		const presenter = await order(h, room(undefined, true), 'k-hotel', 'presenter');
		expect(presenter.ok).toBe(true);
	});

	it("a visitor may preview substitutes on the room's hotel plan (the snapshot does), never apply them", async () => {
		const plan = await h.plan_event(room(undefined, true), {
			kitchenId: 'k-hotel',
			eventId: 'event-xmas-140'
		});
		if (!plan.ok) throw new Error(plan.error.message);
		const p = plan.value.plan;
		const out = p.lines.find((l) => l.state === 'unorderable' && !l.substituteFor)!;
		const a = room('vis-a');
		const preview = await h.find_substitutes(a, {
			planId: p.id,
			version: p.version,
			lineId: out.id,
			apply: false
		});
		expect(preview.ok).toBe(true);
		const apply = await h.find_substitutes(a, {
			planId: p.id,
			version: p.version,
			lineId: out.id,
			apply: true
		});
		expect(!apply.ok && apply.error.sub).toBe('room_store');
	});
});
