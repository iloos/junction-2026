import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

/** In-process Postgres for the fixture path, tests and evals: same schema and migrations as Aiven. */
export async function createFixtureDb(dataDir?: string) {
	const client = await PGlite.create(dataDir ?? 'memory://', { extensions: { vector } });
	const db = drizzle({ client, schema });
	await migrate(db, { migrationsFolder: 'drizzle' });
	return { client, db };
}
export type FixtureDb = Awaited<ReturnType<typeof createFixtureDb>>['db'];
