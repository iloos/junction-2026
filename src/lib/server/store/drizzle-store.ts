/**
 * Store port on Drizzle (PGlite fixture or Aiven Postgres; same schema and migrations).
 * `transact` locks the workspace row, loads the run's state from rows, lets the handler compute ops, assigns
 * per-workspace sequence numbers under the lock, reduces them with the pure `applyOps`, and persists the changed
 * rows + ops in the same transaction (D6). Any error rolls the whole thing back.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Store, Tx } from '$lib/core/ports';
import { applyOps, emptyState, type WorkspaceState } from '$lib/core/state';
import type { DomainError, Kitchen, OpEnvelope, ServerEvent } from '$lib/core/contracts';
import * as schema from '../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any -- driver-agnostic Drizzle handle */
export type AnyDb = PgDatabase<any, typeof schema>;

/** What a `Tx` really is: the Drizzle transaction plus the scope it runs in (the simulator needs the run). */
export interface TxHandle {
	db: AnyDb;
	workspaceId: string;
	runId: string;
}
export const txOf = (tx: Tx) => tx as unknown as TxHandle;

class Rollback extends Error {
	constructor(readonly error: DomainError) {
		super(error.message);
	}
}

export async function loadState(
	db: AnyDb,
	workspaceId: string,
	runId: string
): Promise<WorkspaceState> {
	const s = emptyState(workspaceId, runId);
	const [ws] = await db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, workspaceId));
	s.seq = ws?.lastSeq ?? 0;
	const plans = await db
		.select()
		.from(schema.plans)
		.where(and(eq(schema.plans.workspaceId, workspaceId), eq(schema.plans.runId, runId)));
	for (const p of plans) s.plans[p.id] = p.doc as any;
	const planIds = new Set(Object.keys(s.plans));
	for (const a of await db
		.select()
		.from(schema.approvals)
		.where(eq(schema.approvals.workspaceId, workspaceId)))
		if (planIds.has(a.planId)) s.approvals[a.id] = a.doc as any;
	for (const o of await db
		.select()
		.from(schema.orders)
		.where(eq(schema.orders.workspaceId, workspaceId)))
		if (planIds.has(o.planId)) {
			s.orders[o.id] = o.doc as any;
			s.receipts[(o.receipt as any).id] = o.receipt as any;
		}
	const failed = await db
		.select()
		.from(schema.ops)
		.where(
			and(
				eq(schema.ops.workspaceId, workspaceId),
				eq(schema.ops.runId, runId),
				eq(schema.ops.type, 'CommitOrder')
			)
		);
	for (const row of failed) {
		const op = (row.envelope as OpEnvelope).op;
		if (op.type === 'CommitOrder' && op.outcome.result === 'failed')
			s.failedCommits.push({
				planId: op.outcome.planId,
				idempotencyKey: op.outcome.idempotencyKey,
				code: op.outcome.error.code,
				seq: row.seq
			});
	}
	for (const row of await db
		.select()
		.from(schema.ops)
		.where(
			and(
				eq(schema.ops.workspaceId, workspaceId),
				eq(schema.ops.runId, runId),
				eq(schema.ops.type, 'RecordAnomaly')
			)
		))
		if ((row.envelope as OpEnvelope).op.type === 'RecordAnomaly') {
			const a = ((row.envelope as OpEnvelope).op as any).anomaly;
			s.anomalies[a.id] = a;
		}
	for (const e of await db
		.select()
		.from(schema.enrichments)
		.where(eq(schema.enrichments.workspaceId, workspaceId)))
		s.enrichments[e.productId] = {
			...s.enrichments[e.productId],
			[e.field]: { value: e.value, provenance: e.provenance as any }
		};
	return s;
}

async function persist(
	db: AnyDb,
	before: WorkspaceState,
	after: WorkspaceState,
	envelopes: OpEnvelope[]
) {
	const ws = after.workspaceId;
	for (const [id, plan] of Object.entries(after.plans))
		if (before.plans[id] !== plan)
			await db
				.insert(schema.plans)
				.values({
					workspaceId: ws,
					runId: after.runId,
					id,
					kitchenId: plan.kitchenId,
					version: plan.version,
					state: plan.state,
					doc: plan
				})
				.onConflictDoUpdate({
					target: [schema.plans.workspaceId, schema.plans.id],
					set: { version: plan.version, state: plan.state, doc: plan, updatedAt: sql`now()` }
				});
	for (const [id, a] of Object.entries(after.approvals))
		if (before.approvals[id] !== a)
			await db
				.insert(schema.approvals)
				.values({ workspaceId: ws, id, planId: a.planId, state: a.state, doc: a })
				.onConflictDoUpdate({
					target: [schema.approvals.workspaceId, schema.approvals.id],
					set: { state: a.state, doc: a }
				});
	for (const [id, o] of Object.entries(after.orders))
		if (!before.orders[id]) {
			const receipt = Object.values(after.receipts).find((r) => r.orderId === id);
			await db.insert(schema.orders).values({
				workspaceId: ws,
				id,
				planId: o.planId,
				kitchenId: o.kitchenId,
				idempotencyKey: o.idempotencyKey,
				totalCents: o.totalCents,
				doc: o,
				receipt: receipt ?? {},
				committedAt: o.committedAt
			});
		}
	// Enrichments are workspace knowledge (they outlive a demo run): latest op seq wins per product and field.
	for (const e of envelopes)
		if (e.op.type === 'RecordEnrichment')
			await db
				.insert(schema.enrichments)
				.values({
					workspaceId: ws,
					productId: e.op.productId,
					field: e.op.field,
					value: (e.op.value ?? null) as object,
					provenance: e.op.provenance,
					seq: e.seq,
					runId: e.runId
				})
				.onConflictDoUpdate({
					target: [
						schema.enrichments.workspaceId,
						schema.enrichments.productId,
						schema.enrichments.field
					],
					set: {
						value: sql`excluded.value`,
						provenance: sql`excluded.provenance`,
						seq: sql`excluded.seq`,
						runId: sql`excluded.run_id`,
						updatedAt: sql`now()`
					},
					setWhere: sql`${schema.enrichments.seq} < excluded.seq`
				});
	for (const e of envelopes)
		await db.insert(schema.ops).values({
			workspaceId: ws,
			seq: e.seq,
			runId: e.runId,
			type: e.op.type,
			actorKind: e.actor.kind,
			actorId: e.actor.id,
			via: e.via,
			at: e.at,
			envelope: e
		});
	await db
		.update(schema.workspaces)
		.set({ lastSeq: after.seq })
		.where(eq(schema.workspaces.id, ws));
}

export interface DrizzleStoreOptions {
	/** Which run `transact` and `load` operate on when the caller doesn't say (one active run per workspace). */
	runOf: (workspaceId: string) => string;
	now?: () => Date;
	/** Called after each transaction commits, one op event per persisted op (the ops lane's bus). */
	publish?: (workspaceId: string, events: ServerEvent[]) => void;
}

export function createDrizzleStore(
	db: AnyDb,
	opts: DrizzleStoreOptions
): Store & {
	/** Creates the workspace, run and kitchens (idempotent). */
	ensure(k: {
		workspaceId: string;
		runId: string;
		kitchens: Kitchen[];
		simStart: string;
	}): Promise<void>;
} {
	const now = opts.now ?? (() => new Date());
	return {
		async ensure({ workspaceId, runId, kitchens, simStart }) {
			await db
				.insert(schema.workspaces)
				.values({ id: workspaceId, name: workspaceId })
				.onConflictDoNothing();
			await db
				.insert(schema.runs)
				.values({ id: runId, workspaceId, label: runId, simStart })
				.onConflictDoNothing();
			for (const k of kitchens)
				await db
					.insert(schema.kitchens)
					.values({ workspaceId, id: k.id, mandateVersion: k.mandate.version, doc: k })
					// An existing kitchen keeps its doc (mandate edits included); only a missing standing-order
					// baseline is filled in from the seed, so workspaces created before it existed get it too.
					.onConflictDoUpdate({
						target: [schema.kitchens.workspaceId, schema.kitchens.id],
						set: {
							doc: sql`jsonb_set(${schema.kitchens.doc}, '{usualProducts}', excluded.doc -> 'usualProducts')`
						},
						setWhere: sql`${schema.kitchens.doc} -> 'usualProducts' is null and excluded.doc -> 'usualProducts' is not null`
					});
		},

		async transact(workspaceId, fn) {
			const runId = opts.runOf(workspaceId);
			try {
				const out = await db.transaction(async (raw) => {
					const tdb = raw as unknown as AnyDb;
					await tdb.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
					const state = await loadState(tdb, workspaceId, runId);
					const handle: TxHandle = { db: tdb, workspaceId, runId };
					const r = await fn(handle as unknown as Tx, state);
					if ('error' in r) throw new Rollback(r.error);
					const at = now().toISOString();
					const envelopes: OpEnvelope[] = r.ops.map((p, i) => ({
						...p,
						seq: state.seq + i + 1,
						at
					}));
					const next = applyOps(state, envelopes);
					if (!next.ok) throw new Rollback(next.error);
					await persist(tdb, state, next.value, envelopes);
					return { value: r.value, ops: envelopes };
				});
				opts.publish?.(
					workspaceId,
					out.ops.map((e) => ({ kind: 'op' as const, seq: e.seq, envelope: e }))
				);
				return { ok: true as const, value: out };
			} catch (e) {
				if (e instanceof Rollback) return { ok: false as const, error: e.error };
				throw e;
			}
		},

		load: (workspaceId, runId) => loadState(db, workspaceId, runId),

		async kitchens(workspaceId) {
			const rows = await db
				.select()
				.from(schema.kitchens)
				.where(eq(schema.kitchens.workspaceId, workspaceId));
			return rows.map((r) => ({
				...(r.doc as Kitchen),
				mandate: { ...(r.doc as Kitchen).mandate, version: r.mandateVersion }
			}));
		},

		async idempotency(tx, k) {
			const { db: t } = txOf(tx);
			const where = and(
				eq(schema.idempotency.workspaceId, k.workspaceId),
				eq(schema.idempotency.caller, k.caller),
				eq(schema.idempotency.tool, k.tool),
				eq(schema.idempotency.key, k.key)
			);
			const [row] = await t.select().from(schema.idempotency).where(where);
			if (!row) {
				await t.insert(schema.idempotency).values({ ...k });
				return { status: 'new' };
			}
			if (row.requestHash !== k.requestHash) return { status: 'conflict' };
			return row.response == null
				? { status: 'new' }
				: { status: 'replay', response: row.response };
		},

		async rememberResponse(tx, k, response) {
			await txOf(tx)
				.db.update(schema.idempotency)
				.set({ response: response as object })
				.where(
					and(
						eq(schema.idempotency.workspaceId, k.workspaceId),
						eq(schema.idempotency.caller, k.caller),
						eq(schema.idempotency.tool, k.tool),
						eq(schema.idempotency.key, k.key)
					)
				);
		},

		async lockBudget(tx, k) {
			const { db: t, runId } = txOf(tx);
			await t
				.insert(schema.budgets)
				.values({ ...k, runId, spentCents: 0 })
				.onConflictDoNothing();
			const res = await t.execute(
				sql`select spent_cents from budgets where workspace_id = ${k.workspaceId} and run_id = ${runId} and kitchen_id = ${k.kitchenId} and week = ${k.week} for update`
			);
			const rows = ((res as any).rows ?? res) as { spent_cents: number }[];
			return Number(rows[0]?.spent_cents ?? 0);
		},

		async addSpend(tx, k, cents) {
			const { db: t, runId } = txOf(tx);
			await t
				.update(schema.budgets)
				.set({ spentCents: sql`${schema.budgets.spentCents} + ${cents}` })
				.where(
					and(
						eq(schema.budgets.workspaceId, k.workspaceId),
						eq(schema.budgets.runId, runId),
						eq(schema.budgets.kitchenId, k.kitchenId),
						eq(schema.budgets.week, k.week)
					)
				);
		}
	};
}
