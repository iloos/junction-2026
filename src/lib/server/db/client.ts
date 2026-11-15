import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import * as schema from './schema';

export type DbMode = 'postgres' | 'fixture';

/**
 * Which database a process uses, from what it is and its env:
 * - No DATABASE_URL: fixture mode (PGlite in memory).
 * - Tests: fixture mode, because SvelteKit fills $env/dynamic/private from .env and would point them at the
 *   shared Aiven database; the opt-in Postgres tests set MANDATE_TEST_PG=1.
 * - A dev server (vite dev): fixture mode unless DEV_USE_REMOTE_DB=1. Every worktree's .env names the deployed
 *   database, and a dev server writing it races the deployed app on the same workspaces and runs.
 * - The production build and the node scripts (db:migrate, db:seed) use DATABASE_URL as given.
 */
export function chooseDbMode(o: {
	url: string | undefined;
	dev: boolean;
	vitest: boolean;
	testPg: boolean;
	devUseRemote: boolean;
}): DbMode {
	if (o.vitest) return o.testPg && o.url ? 'postgres' : 'fixture';
	if (!o.url) return 'fixture';
	if (o.dev && !o.devUseRemote) return 'fixture';
	return 'postgres';
}

let devNoticeShown = false;

export function dbMode(): DbMode {
	const mode = chooseDbMode({
		url: env.DATABASE_URL,
		dev,
		vitest: !!process.env.VITEST,
		testPg: process.env.MANDATE_TEST_PG === '1',
		devUseRemote: env.DEV_USE_REMOTE_DB === '1'
	});
	if (dev && !process.env.VITEST && env.DATABASE_URL && mode === 'fixture' && !devNoticeShown) {
		devNoticeShown = true;
		console.warn('dev: using in-memory Postgres (set DEV_USE_REMOTE_DB=1 to use DATABASE_URL)');
	}
	return mode;
}

/**
 * The Aiven CA, from the first of:
 * - PROJECT_CA_CERT: base64 PEM, injected by Aiven Runtime.
 * - PG_CA_CERT: a PEM string, or a path to a PEM file (certs/aiven-ca.pem locally).
 */
function caCert(): string | undefined {
	if (env.PROJECT_CA_CERT) return Buffer.from(env.PROJECT_CA_CERT, 'base64').toString('utf8');
	const v = env.PG_CA_CERT;
	if (!v) return undefined;
	return v.includes('-----BEGIN') ? v : readFileSync(v, 'utf8');
}

function connect(url: string) {
	// sslmode in the URL would override the ssl object below and skip certificate checks.
	const u = new URL(url);
	u.searchParams.delete('sslmode');
	const ca = caCert();
	return postgres(u.toString(), {
		// The pool throttles how many planning queries reach Postgres at once. Measured on prod (15 Nov): at 3, 25
		// concurrent plans finish in ~12 s with no errors; at 10, the shared Postgres slows and both apps time out
		// together. PG_POOL_MAX overrides it. The bus's LISTEN is one more connection, opened apart from this pool.
		max: Number(env.PG_POOL_MAX) || 3,
		idle_timeout: 20,
		connect_timeout: 10,
		ssl: ca ? { ca, rejectUnauthorized: true } : 'require',
		connection: { application_name: 'mandate' },
		...(env.SQL_TRACE === '1' ? { debug: tally } : {})
	});
}

/**
 * Diagnostics, off unless SQL_TRACE=1: counts statements by their first words and prints the top ones every 10 s
 * while queries arrive, to find chatty paths (round trips, not row counts, dominate a plan's latency).
 */
const counts = new Map<string, number>();
let tallyTimer: ReturnType<typeof setTimeout> | null = null;
function tally(_conn: number, query: string) {
	const k = query.replace(/\s+/g, ' ').trim().slice(0, 90);
	counts.set(k, (counts.get(k) ?? 0) + 1);
	tallyTimer ??= setTimeout(() => {
		tallyTimer = null;
		const total = [...counts.values()].reduce((a, b) => a + b, 0);
		console.log(`[sql] ${total} statements`);
		for (const [q, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12))
			console.log(`[sql] ${String(n).padStart(5)}  ${q}`);
		counts.clear();
	}, 10_000);
}

type Sql = ReturnType<typeof postgres>;
const g = globalThis as typeof globalThis & { __mandateSql?: Sql };

/** One pool per process, kept across Vite HMR reloads so dev does not leak connections. */
export function sql(): Sql {
	if (process.env.VITEST && process.env.MANDATE_TEST_PG !== '1')
		throw new Error(
			'Postgres is off in the ordinary test suite (set MANDATE_TEST_PG=1 for test:pg).'
		);
	const url = env.DATABASE_URL;
	if (!url || dbMode() === 'fixture')
		throw new Error(
			'This process is in fixture mode (no DATABASE_URL, or a dev server): no Postgres.'
		);
	return (g.__mandateSql ??= connect(url));
}

/** Drizzle over the shared pool: the Aiven counterpart of createFixtureDb (pglite.ts). */
export async function createPgDb({ runMigrations = true } = {}) {
	const db = drizzle({ client: sql(), schema });
	if (runMigrations) await migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}
export type PgDb = Awaited<ReturnType<typeof createPgDb>>;

export type DbHealth =
	| { db: 'fixture' }
	| { db: 'ok'; latencyMs: number; tls: 'verified' | 'unverified' }
	| { db: 'error'; error: string };

export async function dbHealth(): Promise<DbHealth> {
	if (dbMode() === 'fixture') return { db: 'fixture' };
	const t0 = performance.now();
	try {
		await sql()`select 1`;
		return {
			db: 'ok',
			latencyMs: Math.round(performance.now() - t0),
			tls: caCert() ? 'verified' : 'unverified'
		};
	} catch (e) {
		// Message only: driver errors can carry the host, never the credentials.
		return { db: 'error', error: e instanceof Error ? e.message : String(e) };
	}
}
