/**
 * The web lane's state in Postgres (migration 0004): response cache, spend ledger, recall work queue, findings and
 * applications. One database holds state, queue and audit, so a redeploy loses nothing and several instances
 * share caps and work.
 * - Findings, applications and the queue stay process maps for synchronous reads; `persistedMap` writes each
 *   change through to its table (`attachWebState`) and `hydrateWebState` loads the tables into the maps once.
 * - The spend ledger charges with one conditional upsert per counter (`… WHERE n < cap RETURNING n`), inside a
 *   transaction so the per-key and global counters move together or not at all.
 * - The queue is claimed with `FOR UPDATE SKIP LOCKED` and a lease, so two instances never drain the same item.
 */
import { sql } from 'drizzle-orm';
import type { AnyDb } from '../store/drizzle-store';
import { LimitError, utcDay, type SpendGuard, type SpendLimits } from '../external/ledger';
import type { CacheStore, CacheEntry } from '../external/call';
import type { WorkItem } from './queue';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] =>
	(Array.isArray(res) ? res : ((res as { rows?: Row[] })?.rows ?? [])) as Row[];

/** Tables behind each persisted map slot. */
export const SLOT_TABLE = {
	__webFindings: 'web_findings',
	__webApplications: 'web_applications',
	__webQueue: 'web_queue'
} as const;
export type WebSlot = keyof typeof SLOT_TABLE;

const toMidnightS = (now: Date) => {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};

export function createPgWebState(db: AnyDb, clock: () => Date = () => new Date()) {
	async function upsert(slot: WebSlot, id: string, doc: Record<string, unknown>) {
		if (slot === '__webFindings')
			await db.execute(sql`insert into web_findings (id, workspace_id, kind, at, doc)
				values (${id}, ${(doc.workspaceId as string) ?? null}, ${doc.kind as string}, ${doc.at as string}, ${JSON.stringify(doc)}::jsonb)
				on conflict (id) do update set workspace_id = excluded.workspace_id, kind = excluded.kind, at = excluded.at, doc = excluded.doc`);
		else if (slot === '__webApplications')
			await db.execute(sql`insert into web_applications (key, workspace_id, run_id, finding_id, at, doc)
				values (${id}, ${doc.workspaceId as string}, ${doc.runId as string}, ${doc.findingId as string}, ${doc.at as string}, ${JSON.stringify(doc)}::jsonb)
				on conflict (key) do update set at = excluded.at, doc = excluded.doc`);
		else
			await db.execute(sql`insert into web_queue (id, at, attempts, doc)
				values (${id}, ${doc.at as string}, ${(doc.attempts as number) ?? 0}, ${JSON.stringify(doc)}::jsonb)
				on conflict (id) do update set attempts = excluded.attempts, doc = excluded.doc`);
	}

	async function remove(slot: WebSlot, id: string) {
		if (slot === '__webFindings') await db.execute(sql`delete from web_findings where id = ${id}`);
		else if (slot === '__webApplications')
			await db.execute(sql`delete from web_applications where key = ${id}`);
		else await db.execute(sql`delete from web_queue where id = ${id}`);
	}

	async function load(slot: WebSlot): Promise<Record<string, unknown>[]> {
		const res =
			slot === '__webFindings'
				? await db.execute(sql`select doc from web_findings`)
				: slot === '__webApplications'
					? await db.execute(sql`select doc from web_applications`)
					: await db.execute(sql`select doc from web_queue`);
		return rowsOf(res).map((r) => r.doc as Record<string, unknown>);
	}

	const cache: CacheStore = {
		async get(key) {
			const r = rowsOf(
				await db.execute(sql`select at, value, cost_units from web_cache where key = ${key}`)
			)[0];
			if (!r) return undefined;
			const at = r.at instanceof Date ? r.at.toISOString() : String(r.at);
			return {
				at,
				value: r.value,
				...(r.cost_units != null ? { costUnits: Number(r.cost_units) } : {})
			} as CacheEntry;
		},
		async put(key, api, e) {
			await db.execute(sql`insert into web_cache (key, api, at, value, cost_units)
				values (${key}, ${api}, ${e.at}, ${JSON.stringify(e.value)}::jsonb, ${e.costUnits ?? null})
				on conflict (key) do update set at = excluded.at, value = excluded.value, cost_units = excluded.cost_units`);
		}
	};

	/** Daily caps shared by every instance: the global counter is key '*'. */
	function guard(key: string | null, limits: SpendLimits): SpendGuard {
		return {
			async charge(api) {
				const now = clock();
				const day = utcDay(now);
				await db.transaction(async (tx) => {
					const bump = async (k: string, cap: number) =>
						rowsOf(
							await tx.execute(sql`insert into web_spend (day, api, key, n) values (${day}, ${api}, ${k}, 1)
								on conflict (day, api, key) do update set n = web_spend.n + 1 where web_spend.n < ${cap}
								returning n`)
						).length > 0 && cap > 0;
					if (!(await bump('*', limits.global)))
						throw new LimitError('cap-global', api, toMidnightS(now));
					if (key !== null && !(await bump(key, limits.perKey)))
						throw new LimitError('cap-key', api, toMidnightS(now));
				});
			}
		};
	}

	async function usage(day = utcDay(clock())) {
		return rowsOf(
			await db.execute(sql`select api, key, n from web_spend where day = ${day} order by api, key`)
		).map((r) => ({ api: String(r.api), key: String(r.key), n: Number(r.n) }));
	}

	/**
	 * Claims up to `limit` due queue items for `owner` for `leaseMs`: rows another instance holds are skipped,
	 * not waited for. A claim that outlives its lease (a crashed instance) is due again.
	 */
	async function claimWork(
		owner: string,
		limit: number,
		leaseMs = 120_000,
		maxAttempts = 6
	): Promise<WorkItem[]> {
		return rowsOf(
			await db.execute(sql`update web_queue set locked_by = ${owner},
					locked_until = now() + (${leaseMs} * interval '1 millisecond')
				where id in (
					select id from web_queue
					where attempts < ${maxAttempts} and (locked_until is null or locked_until < now())
					order by at limit ${limit}
					for update skip locked)
				returning id, doc`)
		).map((r) => ({ ...(r.doc as WorkItem), id: String(r.id) }));
	}

	/** ID-only view retained for diagnostics; workers use the documents returned by the atomic claim. */
	async function claimQueue(owner: string, limit: number, leaseMs = 120_000, maxAttempts = 6) {
		return (await claimWork(owner, limit, leaseMs, maxAttempts)).map((w) => w.id);
	}

	async function releaseQueue(owner: string) {
		await db.execute(
			sql`update web_queue set locked_by = null, locked_until = null where locked_by = ${owner}`
		);
	}

	return { upsert, remove, load, cache, guard, usage, claimQueue, claimWork, releaseQueue };
}

export type PgWebState = ReturnType<typeof createPgWebState>;
