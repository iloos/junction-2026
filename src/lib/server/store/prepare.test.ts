/**
 * Review round 4, triage #1: no catalogue (or other non-transaction) query runs while a store transaction holds
 * the lock. On Aiven the pool is 3 connections; a handler that queried the catalogue inside `transact` could
 * starve it under three concurrent commands (and deadlocks outright on single-connection PGlite). Here every
 * catalog call made inside a transaction throws, and the whole Christmas journey plus concurrent calls must pass.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
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

describe('prepare outside the transaction', () => {
	it('never touches the catalogue while a transaction is open', { timeout: 60000 }, async () => {
		const env = await createDbPorts();
		env.overlay.clear();
		const { ports } = env;
		let open = 0;
		const violations: string[] = [];
		const transact = ports.store.transact.bind(ports.store);
		ports.store.transact = async (ws, fn) =>
			transact(ws, async (tx, state) => {
				open++;
				try {
					return await fn(tx, state);
				} finally {
					open--;
				}
			});
		// The simulator holds the same catalog object, so guard the object itself (restored at the end).
		const catalog = ports.catalog as Catalog & Record<string, unknown>;
		const original: Record<string, unknown> = {};
		for (const m of ['get', 'search', 'offers', 'candidates'] as const) {
			original[m] = catalog[m];
			const fn = catalog[m] as (...a: unknown[]) => Promise<unknown>;
			catalog[m] = (async (...a: unknown[]) => {
				if (open > 0) violations.push(m);
				return fn.apply(catalog, a);
			}) as never;
		}
		try {
			const h = createHandlers(ports);
			let { plan } = must(
				await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
			);
			const ham = plan.lines.find((l) => l.productId === '462490')!;
			plan = must(
				await h.find_substitutes(chef, { planId: plan.id, version: plan.version, lineId: ham.id })
			).plan;
			plan = must(
				await h.edit_line(chef, {
					planId: plan.id,
					version: plan.version,
					needId: 'need:joulukinkku',
					patch: { gramsPerGuest: 120 }
				})
			).plan;
			const view = must(await h.get_plan(chef, { planId: plan.id }));
			must(
				await h.approve(chef, {
					approvalId: view.approval!.id,
					planVersion: view.approval!.planVersion,
					termsHash: view.approval!.termsHash,
					decision: 'grant'
				})
			);
			must(
				await h.commit_order(chef, { planId: plan.id, version: plan.version, idempotencyKey: 'k1' })
			);

			// Three commands at once (what starves a 3-connection pool): one wins, the others conflict cleanly.
			const p2 = must(
				await h.place_order(chef, {
					kitchenId: 'k-lounas',
					deliverBy: '2026-12-10',
					idempotencyKey: 'conc',
					lines: [{ productId: '470418', qty: 1, unit: 'ST' }]
				})
			).plan;
			const results = await Promise.all([
				h.edit_line(chef, {
					planId: p2.id,
					version: p2.version,
					lineId: p2.lines[0].id,
					patch: { qty: 2 }
				}),
				h.edit_line(chef, {
					planId: p2.id,
					version: p2.version,
					lineId: p2.lines[0].id,
					patch: { qty: 3 }
				}),
				h.place_order(chef, {
					kitchenId: 'k-lounas',
					deliverBy: '2026-12-10',
					idempotencyKey: 'conc-2',
					lines: [{ productId: '464201', qty: 10, unit: 'ST' }]
				})
			]);
			const edits = results.slice(0, 2);
			expect(edits.filter((r) => r.ok)).toHaveLength(1);
			expect(
				edits.find((r) => !r.ok)?.ok === false &&
					(edits.find((r) => !r.ok) as { error: { code: string } }).error.code
			).toBe('STALE_VERSION');
			expect(results[2].ok).toBe(true);
		} finally {
			Object.assign(catalog, original);
		}
		expect(violations).toEqual([]);
	});
});
