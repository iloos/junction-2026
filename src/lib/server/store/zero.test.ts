/** R5 F11: zero demand buys nothing, on every path (direct order, line edit, need edit, make-in-house). */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { makeInHouseQty } from '$lib/core/demand/sizing';
import { createDbPorts } from './db-ports';

type Kind = keyof typeof SCOPES_BY_ACTOR;
const ctx = (kind: Kind): CallContext => ({
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
const lineOf = (p: Plan, productId: string) => p.lines.find((l) => l.productId === productId);

let h: ToolHandlers;
beforeEach(async () => {
	const env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

describe('zero demand', () => {
	it('a 0 line in a direct order is rejected, out of the terms, and never committed', async () => {
		const placed = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'zero-direct',
				lines: [
					{ productId: '464201', qty: 0, unit: 'ST' },
					{ productId: '464201', qty: 10, unit: 'ST' }
				]
			})
		);
		const [zero, real] = placed.plan.lines;
		expect(zero).toMatchObject({ state: 'rejected', qty: { value: 0 }, lineCents: null });
		expect(zero.view).toMatchObject({ committable: false, reviewable: false, nextAction: 'none' });
		expect(real.qty.value).toBe(10);

		const bad = await h.commit_order(chef, {
			planId: placed.plan.id,
			version: placed.plan.version,
			idempotencyKey: 'zero-explicit',
			lineIds: [zero.id]
		});
		expect(bad.ok ? null : bad.error.code).toBe('INVALID_INPUT');
	});

	it('editing a line to 0 drops it from the order; a need at 0 g/guest buys nothing and comes back', async () => {
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const ham = lineOf(plan, '462490')!;
		expect(ham.qty.value).toBeGreaterThan(0);

		const zeroed = must(
			await h.edit_line(chef, {
				planId: plan.id,
				version: plan.version,
				needId: ham.needId!,
				patch: { gramsPerGuest: 0 }
			})
		).plan;
		const z = lineOf(zeroed, '462490')!;
		expect(z).toMatchObject({ state: 'rejected', qty: { value: 0 } });
		expect(z.view?.nextAction).toBe('none');

		const back = must(
			await h.edit_line(chef, {
				planId: zeroed.id,
				version: zeroed.version,
				needId: ham.needId!,
				patch: { gramsPerGuest: 135 }
			})
		).plan;
		expect(lineOf(back, '462490')!.qty.value).toBe(ham.qty.value);
		expect(lineOf(back, '462490')!.state).not.toBe('rejected');

		const cut = must(
			await h.edit_line(chef, {
				planId: back.id,
				version: back.version,
				lineId: lineOf(back, '462490')!.id,
				patch: { qty: 0 }
			})
		).plan;
		expect(lineOf(cut, '462490')).toMatchObject({ state: 'rejected', qty: { value: 0 } });
	});

	it('a make-in-house ingredient for a 0 kg dish is 0, not one pack', () => {
		expect(makeInHouseQty({ per: 0.5, pack: 1, salesUnit: 'ST' }, 0).value).toBe(0);
		expect(makeInHouseQty({ order: { qty: 3, unit: 'ST' } }, 0).value).toBe(0);
		expect(makeInHouseQty({ per: 0.5, pack: 1, salesUnit: 'ST' }, 0.1).value).toBe(1);
	});
});
