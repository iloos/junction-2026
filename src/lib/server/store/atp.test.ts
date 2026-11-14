/** Available to promise: a quote after a commit shows the supplier's stock minus what this run already committed. */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { inWorkspace } from '../adapters/simulator/overlay';
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
const MILK = '464201';

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts({ now: '2026-11-14T12:00:00+02:00' });
	env.overlay.clear();
	env.overlay.setAvailability({ productId: MILK, amount: 20, label: 'contention drill' });
	h = createHandlers(env.ports);
});

const order = (qty: number, key: string) =>
	h.place_order(ctx('kitchen_agent'), {
		kitchenId: 'k-hotel',
		deliverBy: '2026-11-16',
		idempotencyKey: key,
		lines: [{ productId: MILK, qty, unit: 'ST' }]
	});

describe('quotes subtract committed stock', () => {
	it('shows what is left after a commit, and holds an order larger than that', async () => {
		const before = must(
			await h.quote(ctx('chef'), { productIds: [MILK], deliverBy: '2026-11-16' })
		);
		expect(before.offers[0].availability.amount).toBe(20);

		const a = must(await order(12, 'atp-a'));
		expect(a.plan.lines[0].state).toBe('eligible');
		must(
			await h.commit_order(ctx('chef'), {
				planId: a.plan.id,
				version: a.plan.version,
				idempotencyKey: 'atp-a-commit'
			})
		);

		const after = must(await h.quote(ctx('chef'), { productIds: [MILK], deliverBy: '2026-11-16' }));
		expect(after.offers[0].availability).toMatchObject({ kind: 'known', amount: 8 });
		expect(after.offers[0].availability.provenance.note).toContain('12 already committed');

		const b = must(await order(12, 'atp-b'));
		expect(b.plan.lines[0].reasons).toContain('INSUFFICIENT_STOCK');
		const c = must(await order(8, 'atp-c'));
		expect(c.plan.lines[0].reasons).not.toContain('INSUFFICIENT_STOCK');
	});

	it('another workspace still sees the full supplier stock', async () => {
		const a = must(await order(12, 'atp-a'));
		must(
			await h.commit_order(ctx('chef'), {
				planId: a.plan.id,
				version: a.plan.version,
				idempotencyKey: 'atp-a-commit'
			})
		);
		const other = { ...ctx('chef'), workspaceId: 'ws-other' };
		// The other workspace's overlay layer has no drill: Valio's own amount, untouched by ws-demo's commit.
		const mine = must(
			await inWorkspace('ws-demo', () => h.quote(ctx('chef'), { productIds: [MILK] }))
		);
		const q = must(
			await inWorkspace('ws-other', () =>
				h.quote(other, { productIds: [MILK], deliverBy: '2026-11-16' })
			)
		);
		expect(mine.offers[0].availability.amount).toBe(8);
		expect(q.offers[0].availability.provenance.note ?? '').not.toContain('already committed');
	});
});
