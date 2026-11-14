/**
 * The standing-order baseline: products the kitchen orders in a normal week are not "new" on a fresh run, so the
 * never-delegate `new_sku` rule holds only products the kitchen has genuinely never bought.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { orderedBefore } from '$lib/core/mandate/tier';
import { createHandlers } from '$lib/core/services/handlers';
import { NORMAL_WEEK } from '$lib/kitchen/fixture-plan';
import { KITCHENS } from '$lib/kitchen/catalog';
import { createDbPorts } from './db-ports';

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};

const hotel = KITCHENS.find((k) => k.id === 'k-hotel')!;
const usual = hotel.usualProducts ?? [];

describe('orderedBefore', () => {
	it('is the baseline plus this kitchen’s committed orders, never another kitchen’s', () => {
		const known = orderedBefore(
			{
				orders: {
					a: { kitchenId: 'k-hotel', lines: [{ productId: '462490' }] },
					b: { kitchenId: 'k-lounas', lines: [{ productId: '471247' }] }
				}
			},
			{ id: 'k-hotel', usualProducts: ['464201'] }
		);
		expect([...known].sort()).toEqual(['462490', '464201']);
	});
});

describe('existing workspaces get the baseline', () => {
	it('a kitchen stored before the baseline existed gains it on boot; its mandate edits are kept', async () => {
		const { usualProducts: _drop, ...old } = hotel;
		void _drop;
		const edited = { ...old, mandate: { ...old.mandate, words: 'edited by the chef' } };
		const first = await createDbPorts({ kitchens: [edited] });
		expect((await first.store.kitchens('ws-demo'))[0].usualProducts).toBeUndefined();

		const again = await createDbPorts({ db: first.db, kitchens: [hotel] });
		const [k] = await again.store.kitchens('ws-demo');
		expect([...(k.usualProducts ?? [])].sort()).toEqual([...usual].sort());
		expect(k.mandate.words).toBe('edited by the chef');
	});
});

describe('standing-order baseline on a fresh Christmas run', () => {
	let h: ToolHandlers;
	beforeEach(async () => {
		const env = await createDbPorts();
		env.overlay.clear();
		h = createHandlers(env.ports);
	});

	it('the hotel seed has a baseline and the kitchen view reads the same products', () => {
		expect(usual.length).toBeGreaterThan(0);
		expect(Object.keys(NORMAL_WEEK.usual).sort()).toEqual([...usual].sort());
	});

	it('holds new products as new, never the normal week’s own products', async () => {
		const r = await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
		if (!r.ok) throw new Error(r.error.message);
		const lines = r.value.plan.lines;
		const newSku = lines.filter((l) => l.reasons.includes('new_sku'));

		const usualInPlan = lines.filter((l) => usual.includes(l.productId));
		expect(usualInPlan.length).toBeGreaterThan(0);
		for (const l of usualInPlan) expect(l.reasons).not.toContain('new_sku');

		// Event-only products the hotel has never bought still need the chef.
		expect(newSku.length).toBeGreaterThan(0);
		for (const l of newSku) expect(usual).not.toContain(l.productId);
	});
});
