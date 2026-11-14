/**
 * The web lane's server wiring: picks live or fixture adapters from the env, and gives routes the
 * store, catalogue index and current-run scope to record findings in.
 *
 * Env (names only in .env.example):
 * - `WEB_PROVIDER` = `live` | `fixture` (default `fixture` in dev and tests, `live` when both keys are set in production)
 * - `CONTEXT_DEV_API_KEY`, `EXA_API_KEY`
 * - `CONTEXT_DEV_WEBHOOK_SECRET`: the monitor's webhook signing secret, also accepted as the
 *   `x-mandate-webhook-secret` header from our own scripts
 * - `WEB_CACHE_DIR` (default `scratch/web-cache`): response cache, findings, recall work queue, spend ledger
 * - `WEB_CAP_PER_KEY`, `WEB_CAP_GLOBAL`: daily call caps per API (spend.ts)
 */
import { sql } from 'drizzle-orm';
import { join } from 'node:path';
import type { Product } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import type { Trace } from '../adapters/llm/trace';
import { createServerPorts } from '../store/server-ports';
import { realHandlers } from '../tools/handlers';
import { currentRun } from '../demo/run';
import { DEMO_WORKSPACE } from '../store/db-ports';
import type { AnyDb } from '../store/drizzle-store';
import { createWebHttp } from './http';
import { createContextDev, type RecallSource } from './contextdev';
import { createExa, type FactSearch } from './exa';
import { createFixtureFactSearch, createFixtureRecallSource } from './fixture';
import { createFindings } from './findings';
import { createWorkQueue } from './queue';
import { createSpendLedger, spendLimits } from './spend';
import { hasWords, memoryIndex, type CatalogIndex } from './recall';

type Env = Record<string, string | undefined>;

export function webMode(
	env: Env,
	isProd = process.env.NODE_ENV === 'production'
): 'live' | 'fixture' {
	if (process.env.VITEST) return 'fixture';
	if (env.WEB_PROVIDER === 'live' || env.WEB_PROVIDER === 'fixture') return env.WEB_PROVIDER;
	return isProd && env.CONTEXT_DEV_API_KEY && env.EXA_API_KEY ? 'live' : 'fixture';
}

export function cacheDir(env: Env): string {
	return env.WEB_CACHE_DIR || join('scratch', 'web-cache');
}

const g = globalThis as typeof globalThis & {
	__webSpend?: ReturnType<typeof createSpendLedger>;
};
/** One spend ledger per process, persisted next to the cache so a restart keeps the day's counts. */
export const spendLedger = (env: Env) =>
	(g.__webSpend ??= createSpendLedger(join(cacheDir(env), 'spend.json')));

/**
 * Who a paid call is charged to: `<actor kind>:<key label>` for a keyed caller, null for the monitor
 * (bound by the global cap only).
 */
export const callerKey = (actor?: { kind: string; id: string } | null) =>
	actor && actor.kind !== 'system' ? `${actor.kind}:${actor.id}` : null;

export function webClients(
	env: Env,
	trace?: Trace,
	caller: string | null = null
): { recalls: RecallSource; exa: FactSearch } {
	const mode = webMode(env);
	const dir = cacheDir(env);
	const guard = spendLedger(env).guard(caller, spendLimits(env));
	const recalls =
		mode === 'live' && env.CONTEXT_DEV_API_KEY
			? createContextDev(
					createWebHttp({
						api: 'context.dev',
						apiKey: env.CONTEXT_DEV_API_KEY,
						cacheDir: join(dir, 'context-dev'),
						trace,
						guard
					})
				)
			: createFixtureRecallSource();
	const exa =
		mode === 'live' && env.EXA_API_KEY
			? createExa(
					createWebHttp({
						api: 'exa',
						apiKey: env.EXA_API_KEY,
						cacheDir: join(dir, 'exa'),
						trace,
						guard
					})
				)
			: createFixtureFactSearch();
	return { recalls, exa };
}

export function contextDevAdmin(env: Env) {
	if (!env.CONTEXT_DEV_API_KEY) throw new Error('CONTEXT_DEV_API_KEY is not set');
	return createContextDev(
		createWebHttp({
			api: 'context.dev',
			apiKey: env.CONTEXT_DEV_API_KEY,
			cacheDir: join(cacheDir(env), 'context-dev')
		})
	);
}

export const findingsFor = (env: Env) => createFindings(join(cacheDir(env), 'findings.json'));
export const queueFor = (env: Env) => createWorkQueue(join(cacheDir(env), 'recall-queue.json'));

/** Catalogue reads for recall matching: the file catalogue in memory, or the products table. */
export function catalogIndex(catalog: Catalog, db: AnyDb): CatalogIndex {
	const fileProducts = (catalog as Catalog & { products?: Map<string, Product> }).products;
	if (fileProducts) return memoryIndex(fileProducts.values());
	return {
		async byGtin(gtins) {
			if (!gtins.length) return [];
			const rows = (await db.execute(
				sql`select doc from products where doc->>'gtin' in (${sql.join(
					gtins.map((g) => sql`${g}`),
					sql`, `
				)})`
			)) as unknown as { rows?: { doc: Product }[] } | { doc: Product }[];
			return (Array.isArray(rows) ? rows : (rows.rows ?? [])).map((r) => r.doc);
		},
		async byBrandOrVendor(term, limit = 400) {
			const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
			const rows = (await db.execute(
				sql`select doc from products where lower(coalesce(doc->>'brand','')) like ${like} or lower(doc->>'vendor') like ${like} limit ${limit}`
			)) as unknown as { rows?: { doc: Product }[] } | { doc: Product }[];
			return (Array.isArray(rows) ? rows : (rows.rows ?? []))
				.map((r) => r.doc)
				.filter((p) => hasWords(p.brand, term) || hasWords(p.vendor, term));
		}
	};
}

/** The served store and catalogue (built the way the tools build them, so the bus publish hook is in place). */
export async function servedPorts() {
	await realHandlers();
	const b = await createServerPorts();
	const workspaceId = b.workspaceId ?? DEMO_WORKSPACE;
	return {
		store: b.store,
		catalog: b.ports.catalog,
		index: catalogIndex(b.ports.catalog, b.db as unknown as AnyDb),
		scope: { workspaceId, runId: currentRun(workspaceId) }
	};
}
