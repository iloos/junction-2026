/**
 * Applies drizzle/ migrations to DATABASE_URL (Aiven) with a verified TLS connection.
 *
 *   node --env-file=.env scripts/db-migrate.ts
 *
 * Self-contained so Node can run it without `$lib` resolution. Same CA rules as src/lib/server/db/client.ts.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('db-migrate: DATABASE_URL is not set (use node --env-file=.env).');
	process.exit(1);
}
const u = new URL(url);
u.searchParams.delete('sslmode');
const caEnv = process.env.PG_CA_CERT;
const ca = caEnv && !caEnv.includes('-----BEGIN') ? readFileSync(caEnv, 'utf8') : caEnv;
const sql = postgres(u.toString(), {
	max: 1,
	ssl: ca ? { ca, rejectUnauthorized: true } : 'require',
	onnotice: () => {}
});
const t0 = Date.now();
await migrate(drizzle({ client: sql }), { migrationsFolder: 'drizzle' });
const [{ n }] =
	await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
console.log(`db-migrate: ok, ${n} public tables, ${Date.now() - t0} ms`);
await sql.end();
