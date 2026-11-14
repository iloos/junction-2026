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
 * - `WEB_RECALL_WORKSPACES`: where monitor recalls are applied (default the demo workspace)
 */
import { sql } from 'drizzle-orm';
import { join } from 'node:path';
import type { Product } from '$lib/core/contracts';
import type { CallContext, Catalog, WebExecutionContext } from '$lib/core/ports';
import type { Trace } from '../adapters/llm/trace';
import { createServerPorts } from '../store/server-ports';
import { realHandlers } from '../tools/handlers';
import { currentRun } from '../demo/run';
import { DEMO_WORKSPACE } from '../store/db-ports';
import type { AnyDb } from '../store/drizzle-store';
import { createWebHttp } from './http';
import {
	createContextDev,
	createNewsSource,
	fixtureNewsSource,
	type NewsSource,
	type RecallSource
} from './contextdev';
import { createExa, type FactSearch } from './exa';
import { createFixtureFactSearch, createFixtureRecallSource } from './fixture';
import { createFindings } from './findings';
import { createWorkQueue } from './queue';
import { createApplications } from './applications';
import { createWebTools } from './tools';
import { busTrace } from './watch';
import { createSpendLedger, spendLimits, type SpendLedger } from './spend';
import { createPgWebState, type PgWebState, type WebSlot } from './pg-state';
import { attachStateSink, hydrateSlot, persistedMap } from './persist';
import type { Finding } from './findings';
import type { WorkItem } from './queue';
import type { Application } from './applications';
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
	__webPg?: PgWebState;
	__webReady?: Promise<void>;
};

/**
 * Loads the web state from Postgres (migration 0004) once per process and writes every later change through:
 * findings, applications and the recall queue hydrate their maps; the response cache and the spend caps read
 * and charge the shared tables. Routes and tools await it before reading web state. Without a database (unit
 * tests that never call it), the JSON files under `WEB_CACHE_DIR` stay the store.
 */
export function webStateReady(env: Env): Promise<void> {
	if (process.env.VITEST && !env.WEB_STATE_PG) return Promise.resolve();
	g.__webReady ??= (async () => {
		const { db } = await served();
		const pg = createPgWebState(db as unknown as AnyDb);
		const slots: [WebSlot, Map<string, unknown>, (x: Record<string, unknown>) => string][] = [
			['__webFindings', findingsMap(env), (x) => String(x.id)],
			['__webApplications', applicationsMap(env), (x) => String(x.key)],
			['__webQueue', queueMap(env), (x) => String(x.id)]
		];
		for (const [slot, map, keyOf] of slots)
			hydrateSlot(slot, map as Map<string, Record<string, unknown>>, await pg.load(slot), keyOf);
		attachStateSink(pg);
		g.__webPg = pg;
	})();
	g.__webReady.catch((e) => {
		console.error('[web] Postgres state unavailable; using files', (e as Error)?.message ?? e);
		g.__webReady = undefined;
	});
	return g.__webReady.catch(() => {});
}

/** The Postgres web state once `webStateReady` has run, else null (files). */
export const webPg = (): PgWebState | null => g.__webPg ?? null;
/** One spend ledger per process, persisted next to the cache so a restart keeps the day's counts. */
export const spendLedger = (env: Env): Pick<SpendLedger, 'guard'> =>
	g.__webPg ?? (g.__webSpend ??= createSpendLedger(join(cacheDir(env), 'spend.json')));

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
): { recalls: RecallSource; exa: FactSearch; news: NewsSource } {
	const mode = webMode(env);
	const dir = cacheDir(env);
	// Internal callers (the monitor) are bound by the global cap only.
	const guard = spendLedger(env).guard(
		caller?.startsWith('system:') ? null : caller,
		spendLimits(env)
	);
	const recalls =
		mode === 'live' && env.CONTEXT_DEV_API_KEY
			? createContextDev(
					createWebHttp({
						api: 'context.dev',
						apiKey: env.CONTEXT_DEV_API_KEY,
						cacheDir: join(dir, 'context-dev'),
						store: g.__webPg?.cache,
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
						store: g.__webPg?.cache,
						trace,
						guard
					})
				)
			: createFixtureFactSearch();
	const news =
		mode === 'live' && env.CONTEXT_DEV_API_KEY
			? createNewsSource(
					createWebHttp({
						api: 'context.dev',
						apiKey: env.CONTEXT_DEV_API_KEY,
						cacheDir: join(dir, 'context-dev'),
						store: g.__webPg?.cache,
						trace,
						guard
					})
				)
			: fixtureNewsSource;
	return { recalls, exa, news };
}

const FILES = {
	findings: 'findings.json',
	queue: 'recall-queue.json',
	applications: 'recall-applications.json'
} as const;
const findingsMap = (env: Env) =>
	persistedMap<Finding>('__webFindings', join(cacheDir(env), FILES.findings), (f) => f.id).map;
const queueMap = (env: Env) =>
	persistedMap<WorkItem>('__webQueue', join(cacheDir(env), FILES.queue), (w) => w.id).map;
const applicationsMap = (env: Env) =>
	persistedMap<Application>(
		'__webApplications',
		join(cacheDir(env), FILES.applications),
		(a) => a.key
	).map;

export const findingsFor = (env: Env) => createFindings(join(cacheDir(env), FILES.findings));
export const queueFor = (env: Env) => createWorkQueue(join(cacheDir(env), FILES.queue));
export const applicationsFor = (env: Env) =>
	createApplications(join(cacheDir(env), FILES.applications));

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

async function served() {
	await realHandlers();
	return createServerPorts();
}

/** The web tool handlers wired to this env: live or fixture clients, the shared findings. */
export function webTools(env: Env) {
	return createWebTools({
		clients: (w) => webClients(env, busTrace(scopeOf(w), { lane: 'web' }), w.spendKey),
		findings: findingsFor(env)
	});
}

/** A web route or tool's execution context plus the catalogue index recall matching needs. */
export type WebRun = WebExecutionContext & { index: CatalogIndex };

/**
 * What a web route or web tool runs under: the caller's own workspace and run (from its key), the
 * process's ports (the store is workspace-scoped per call), and the key its spend counts against. Web
 * code never falls back to the default workspace.
 */
export async function webContext(ctx: CallContext): Promise<WebRun> {
	const b = await served();
	await webStateReady(process.env);
	return {
		ctx,
		ports: { clock: b.ports.clock, catalog: b.ports.catalog, store: b.store, web: b.ports.web },
		spendKey: callerKey(ctx.actor) ?? `system:${ctx.actor.id}`,
		index: catalogIndex(b.ports.catalog, b.db as unknown as AnyDb)
	};
}

/** The target scope of a web context: the caller's workspace and run. */
export const scopeOf = (w: WebExecutionContext) => ({
	workspaceId: w.ctx.workspaceId,
	runId: w.ctx.runId
});

/**
 * Where the monitor's recalls are applied (it has no caller): `WEB_RECALL_WORKSPACES`, comma-separated,
 * default the demo workspace. Each gets its current run; a reset run is caught up from stored reads.
 */
export async function recallTargets(env: Env): Promise<WebRun[]> {
	const ids = (env.WEB_RECALL_WORKSPACES || DEMO_WORKSPACE)
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean);
	return Promise.all(
		ids.map((workspaceId) =>
			webContext({
				workspaceId,
				runId: currentRun(workspaceId),
				actor: { kind: 'system', id: 'web:context.dev' },
				scopes: [],
				via: 'web:contextdev'
			})
		)
	);
}
