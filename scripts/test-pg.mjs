// Opt-in Postgres proofs, never part of the ordinary suite, against DATABASE_URL:
// - src/lib/server/store/pg-race.test.ts (R0-e concurrency), in a fresh workspace/run it deletes afterwards;
// - src/lib/server/web/catalog-index.test.ts (F31), read-only against the real catalogue.
import { spawnSync } from 'node:child_process';

const r = spawnSync(
	'pnpm',
	[
		'exec',
		'vitest',
		'run',
		'--project',
		'server',
		'src/lib/server/store/pg-race.test.ts',
		'src/lib/server/web/catalog-index.test.ts'
	],
	{ stdio: 'inherit', shell: true, env: { ...process.env, MANDATE_TEST_PG: '1' } }
);
process.exit(r.status ?? 1);
