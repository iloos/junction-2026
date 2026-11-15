/**
 * The `traces` table (migration 0005) behind one small port: insert a batch, prune old rows, list with filters,
 * and a per-source summary. The same Drizzle code runs on Aiven and on PGlite (tests, fixture mode).
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { traces } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';

export type TraceRow = typeof traces.$inferInsert;
export type StoredTrace = typeof traces.$inferSelect;

export interface TraceFilter {
	/** ISO time; default: the last hour. */
	since?: string;
	workspaceId?: string;
	/** One run of the workspace (a sandbox's current run): what this plan's session cost. */
	runId?: string;
	requestId?: string;
	source?: string;
	limit?: number;
}

export interface SourceSummary {
	source: string;
	count: number;
	p50Ms: number | null;
	p95Ms: number | null;
	/** Share of calls that failed, 0..1. */
	errorRate: number;
	/** Share of calls answered from the cache or the replay book, 0..1. */
	cacheHitRate: number;
	tokensIn: number;
	tokensOut: number;
	/** Calls per answer mode: a live call, the cache, the replay book, the fixture; `none` for calls with no mode (tools). */
	byMode: { live: number; cache: number; replay: number; fixture: number; none: number };
	/** Live calls that succeeded: the only count that says the provider itself answered. */
	liveOk: number;
}

export interface TraceStore {
	insert(rows: TraceRow[]): Promise<void>;
	/** Deletes rows older than `before`; returns how many went. */
	prune(before: Date): Promise<number>;
	list(f: TraceFilter): Promise<StoredTrace[]>;
	summary(f: Omit<TraceFilter, 'limit' | 'requestId'>): Promise<SourceSummary[]>;
}

const HOUR_MS = 60 * 60_000;
export const MAX_LIST = 500;

const rowsOf = (res: unknown): Record<string, unknown>[] =>
	(Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? [])) as Record<
		string,
		unknown
	>[];

const sinceOf = (s: string | undefined, now: Date) => {
	const t = s ? Date.parse(s) : NaN;
	return new Date(Number.isFinite(t) ? t : now.getTime() - HOUR_MS).toISOString();
};

export function createTraceStore(db: AnyDb, clock: () => Date = () => new Date()): TraceStore {
	const where = (f: TraceFilter) =>
		and(
			gte(traces.at, sinceOf(f.since, clock())),
			f.workspaceId ? eq(traces.workspaceId, f.workspaceId) : undefined,
			f.runId ? eq(traces.runId, f.runId) : undefined,
			f.requestId ? eq(traces.requestId, f.requestId) : undefined,
			f.source ? eq(traces.source, f.source) : undefined
		);
	return {
		async insert(rows) {
			if (rows.length) await db.insert(traces).values(rows).onConflictDoNothing();
		},
		async prune(before) {
			const gone = await db
				.delete(traces)
				.where(lt(traces.at, before.toISOString()))
				.returning({ id: traces.id });
			return gone.length;
		},
		async list(f) {
			const limit = Math.min(Math.max(1, f.limit ?? 200), MAX_LIST);
			return db.select().from(traces).where(where(f)).orderBy(desc(traces.at)).limit(limit);
		},
		async summary(f) {
			const res = await db.execute(sql`
				select source,
					count(*)::int as count,
					percentile_cont(0.5) within group (order by latency_ms) as p50,
					percentile_cont(0.95) within group (order by latency_ms) as p95,
					avg(case when ok then 0 else 1 end)::float as error_rate,
					avg(case when cache in ('cache', 'replay') then 1 else 0 end)::float as cache_rate,
					coalesce(sum(tokens_in), 0)::int as tokens_in,
					coalesce(sum(tokens_out), 0)::int as tokens_out,
					count(*) filter (where cache = 'live')::int as m_live,
					count(*) filter (where cache = 'cache')::int as m_cache,
					count(*) filter (where cache = 'replay')::int as m_replay,
					count(*) filter (where cache = 'fixture')::int as m_fixture,
					count(*) filter (where cache = 'live' and ok)::int as live_ok
				from traces
				where ${where(f)}
				group by source
				order by count(*) desc`);
			const num = (v: unknown) => (v == null ? null : Math.round(Number(v)));
			return rowsOf(res).map((r) => ({
				source: String(r.source),
				count: Number(r.count),
				p50Ms: num(r.p50),
				p95Ms: num(r.p95),
				errorRate: Number(r.error_rate) || 0,
				cacheHitRate: Number(r.cache_rate) || 0,
				tokensIn: Number(r.tokens_in) || 0,
				tokensOut: Number(r.tokens_out) || 0,
				byMode: {
					live: Number(r.m_live) || 0,
					cache: Number(r.m_cache) || 0,
					replay: Number(r.m_replay) || 0,
					fixture: Number(r.m_fixture) || 0,
					none:
						Number(r.count) -
						(Number(r.m_live) || 0) -
						(Number(r.m_cache) || 0) -
						(Number(r.m_replay) || 0) -
						(Number(r.m_fixture) || 0)
				},
				liveOk: Number(r.live_ok) || 0
			}));
		}
	};
}
