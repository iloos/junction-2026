import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

export type DbMode = 'postgres' | 'fixture';

/** No DATABASE_URL means fixture mode: the app runs without Postgres. */
export function dbMode(): DbMode {
	return env.DATABASE_URL ? 'postgres' : 'fixture';
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
		// The free Aiven plan allows 15 connections in total, shared by every instance and dev server.
		max: 3,
		idle_timeout: 20,
		connect_timeout: 10,
		ssl: ca ? { ca, rejectUnauthorized: true } : 'require',
		connection: { application_name: 'mandate' }
	});
}

type Sql = ReturnType<typeof postgres>;
const g = globalThis as typeof globalThis & { __mandateSql?: Sql };

/** One pool per process, kept across Vite HMR reloads so dev does not leak connections. */
export function sql(): Sql {
	const url = env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set (fixture mode has no Postgres).');
	return (g.__mandateSql ??= connect(url));
}

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
