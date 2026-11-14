/**
 * Simulator stock truth per run (sim_stock). A product's row is seeded lazily from its current offer (cached Valio
 * amount with any overlay), then commits consume it with one atomic conditional update (D6: no read-then-write).
 * Terminal / unknown supply has no row: it commits as "awaiting supplier", never as known-stock cover.
 */
import { and, eq, sql } from 'drizzle-orm';
import { err, ok } from '$lib/core/contracts';
import type { Catalog, Simulator } from '$lib/core/ports';
import * as schema from '../../db/schema';
import { txOf } from '../../store/drizzle-store';

export function createSimulator(catalog: Catalog, opts: { today: () => string }): Simulator {
	return {
		events: () => [],
		async consume(tx, productId, qty, given) {
			const { db, workspaceId, runId } = txOf(tx);
			const key = and(
				eq(schema.simStock.workspaceId, workspaceId),
				eq(schema.simStock.runId, runId),
				eq(schema.simStock.productId, productId)
			);
			let [row] = await db.select().from(schema.simStock).where(key);
			if (!row) {
				// The caller's offer, fetched before the transaction; the catalog is only a fallback (fixture path).
				const offer = given ?? (await catalog.offers([productId], opts.today())).offers[0];
				const a = offer?.availability;
				if (!a) return err('NOT_FOUND', `product ${productId}`);
				if (a.kind === 'unknown') return ok({ lotId: null, confirmed: false });
				if (a.kind !== 'known')
					return err('INSUFFICIENT_STOCK', `${productId} is ${a.kind}`, {
						detail: { kind: a.kind }
					});
				await db
					.insert(schema.simStock)
					.values({
						workspaceId,
						runId,
						productId,
						available: a.amount,
						label:
							a.provenance.source === 'simulator'
								? (a.provenance.note ?? 'simulated')
								: 'from Valio cache'
					})
					.onConflictDoNothing();
				[row] = await db.select().from(schema.simStock).where(key);
			}
			if (row.available === null)
				return ok({ lotId: `lot-${productId}-${runId}`, confirmed: true });
			const updated = await db
				.update(schema.simStock)
				.set({ available: sql`${schema.simStock.available} - ${qty}` })
				.where(and(key, sql`${schema.simStock.available} >= ${qty}`))
				.returning({ available: schema.simStock.available });
			if (updated.length === 0)
				return err('INSUFFICIENT_STOCK', `${productId}: ${row.available} left, ${qty} asked`, {
					detail: { available: row.available, asked: qty }
				});
			return ok({ lotId: `lot-${productId}-${runId}`, confirmed: true });
		}
	};
}
