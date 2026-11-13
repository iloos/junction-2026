import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createFixtureDb } from './pglite';
import { workspaces } from './schema';

describe('fixture database', () => {
	it('boots PGlite with pgvector and applies the migrations', async () => {
		const { client, db } = await createFixtureDb();
		await db.insert(workspaces).values({ id: 'ws-test', name: 'test' });
		const rows = await db.select().from(workspaces);
		expect(rows).toHaveLength(1);
		const ext = await db.execute(sql`select extname from pg_extension where extname = 'vector'`);
		expect(ext.rows).toHaveLength(1);
		await client.close();
	}, 30_000);
});
