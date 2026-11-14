/**
 * R0-e: the commit guarantees under real concurrency on Postgres (Aiven). Opt-in only: `pnpm test:pg`
 * (MANDATE_TEST_PG=1 and DATABASE_URL). Runs in its own fresh workspace and run, never ws-demo, and deletes every
 * row it wrote. Asserts the end state (orders, stock, spend, ops), not just call results:
 *  1. the same plan and key committed twice at once → one receipt, one order;
 *  2. the same plan with different keys at once → each line bought once;
 *  3. two plans racing for one stock lot → never negative stock, exactly one purchase;
 *  4. two orders against one kitchen-week budget → no spend over the weekly cap without a human.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createPgCatalog } from '../adapters/catalog/pg';
import { SimOverlay } from '../adapters/simulator/overlay';
import { createPgDb } from '../db/client';
import * as schema from '../db/schema';
import { createDbPorts } from './db-ports';
import type { AnyDb } from './drizzle-store';

const ON = process.env.MANDATE_TEST_PG === '1';
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WS = `ws-race-${tag}`;
const RUN = `run-race-${tag}`;

const chef: CallContext = {
	workspaceId: WS,
	runId: RUN,
	actor: { kind: 'chef', id: 'race-chef' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test:pg'
};
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe.skipIf(!ON)('Postgres concurrency (opt-in)', () => {
	let db: AnyDb;
	let h: ToolHandlers;
	let overlay: SimOverlay;
	let env: Awaited<ReturnType<typeof createDbPorts>>;

	beforeAll(async () => {
		db = (await createPgDb({ runMigrations: false })) as unknown as AnyDb;
		overlay = new SimOverlay();
		env = await createDbPorts({
			db,
			workspaceId: WS,
			runId: RUN,
			overlay,
			catalog: createPgCatalog(db, { overlay })
		});
		h = createHandlers(env.ports);
	}, 60000);

	afterAll(async () => {
		if (!db) return;
		for (const t of [
			schema.ops,
			schema.orders,
			schema.approvals,
			schema.plans,
			schema.budgets,
			schema.idempotency,
			schema.simStock,
			schema.kitchens
		])
			await db.delete(t).where(eq((t as typeof schema.ops).workspaceId, WS));
		await db.delete(schema.runs).where(eq(schema.runs.workspaceId, WS));
		await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
	}, 60000);

	/** One in-mandate order for the lunch kitchen (no new-SKU rule, chef caller → act tier). */
	async function actOrder(key: string, productId: string, qty: number) {
		const p = must(
			await h.place_order(chef, {
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-10',
				idempotencyKey: key,
				lines: [{ productId, qty, unit: 'ST' }]
			})
		).plan;
		expect(p.lines[0]).toMatchObject({ state: 'eligible', tier: 'act' });
		return p;
	}
	const ordersFor = async (planId: string) =>
		db
			.select()
			.from(schema.orders)
			.where(and(eq(schema.orders.workspaceId, WS), eq(schema.orders.planId, planId)));

	it('1: same plan and key at once → one receipt, one order', { timeout: 60000 }, async () => {
		const p = await actOrder('race-1', '464201', 10);
		const input = { planId: p.id, version: p.version, idempotencyKey: 'race-1-commit' };
		const [a, b] = await Promise.all([h.commit_order(chef, input), h.commit_order(chef, input)]);
		expect(must(a).receiptId).toBe(must(b).receiptId);
		expect(await ordersFor(p.id)).toHaveLength(1);
	});

	it(
		'2: same plan, different keys at once → each line bought once',
		{ timeout: 60000 },
		async () => {
			const p = await actOrder('race-2', '464201', 10);
			const rs = await Promise.all(
				['k-a', 'k-b', 'k-c'].map((k) =>
					h.commit_order(chef, { planId: p.id, version: p.version, idempotencyKey: k })
				)
			);
			expect(rs.filter((r) => r.ok)).toHaveLength(1);
			const orders = await ordersFor(p.id);
			expect(orders).toHaveLength(1);
			expect(orders[0].totalCents).toBe(1560);
		}
	);

	it(
		'3: two plans racing for one lot → no negative stock, one purchase',
		{ timeout: 60000 },
		async () => {
			overlay.setAvailability({ productId: '470418', amount: 5, label: 'simulated: 5 left' });
			const a = await actOrder('race-3a', '470418', 4);
			const b = await actOrder('race-3b', '470418', 4);
			const rs = await Promise.all([
				h.commit_order(chef, { planId: a.id, version: a.version, idempotencyKey: 'c3a' }),
				h.commit_order(chef, { planId: b.id, version: b.version, idempotencyKey: 'c3b' })
			]);
			expect(rs.filter((r) => r.ok)).toHaveLength(1);
			const loser = rs.find((r) => !r.ok) as { error: { code: string } };
			expect(loser.error.code).toBe('INSUFFICIENT_STOCK');
			const [stock] = await db
				.select()
				.from(schema.simStock)
				.where(and(eq(schema.simStock.workspaceId, WS), eq(schema.simStock.productId, '470418')));
			expect(stock.available).toBe(1);
			overlay.clear();
		}
	);

	it(
		'4: one kitchen-week budget → no spend over the weekly cap without a human',
		{ timeout: 60000 },
		async () => {
			// 4,500 € already spent in the delivery week; the lunch kitchen may spend 5,000 € a week alone.
			await env.ports.store.transact(WS, async (tx) => {
				const k = { workspaceId: WS, kitchenId: 'k-lounas', week: '2026-W50' };
				const spent = await env.ports.store.lockBudget(tx, k);
				await env.ports.store.addSpend(tx, k, 450000 - spent);
				return { ops: [], value: null };
			});
			const a = await actOrder('race-4a', '464201', 250); // 390 € each: one fits, two do not
			const b = await actOrder('race-4b', '464201', 250);
			const rs = await Promise.all([
				h.commit_order(chef, { planId: a.id, version: a.version, idempotencyKey: 'c4a' }),
				h.commit_order(chef, { planId: b.id, version: b.version, idempotencyKey: 'c4b' })
			]);
			expect(rs.filter((r) => r.ok)).toHaveLength(1);
			expect((rs.find((r) => !r.ok) as { error: { code: string } }).error.code).toBe(
				'CAP_EXCEEDED'
			);
			const [budget] = await db
				.select()
				.from(schema.budgets)
				.where(and(eq(schema.budgets.workspaceId, WS), eq(schema.budgets.week, '2026-W50')));
			expect(budget.spentCents).toBe(450000 + 39000);
			expect(budget.spentCents).toBeLessThanOrEqual(500000);

			// The op log agrees: one committed and one failed commit for the two plans, seqs gap-free.
			const ops = await db
				.select({ seq: schema.ops.seq, env: schema.ops.envelope })
				.from(schema.ops)
				.where(eq(schema.ops.workspaceId, WS))
				.orderBy(schema.ops.seq);
			const seqs = ops.map((o) => o.seq);
			expect(seqs).toEqual(seqs.map((_, i) => seqs[0] + i));
			const [{ n }] = (await db.execute(
				sql`select count(*)::int as n from ops where workspace_id = ${WS} and type = 'CommitOrder'`
			)) as unknown as { n: number }[];
			expect(n).toBeGreaterThanOrEqual(2);
		}
	);
});
