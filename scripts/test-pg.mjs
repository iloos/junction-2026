// Opt-in Postgres concurrency proof (R0-e): runs src/lib/server/store/pg-race.test.ts against DATABASE_URL
// in a fresh workspace/run that the test deletes afterwards. Never part of the ordinary suite.
import { spawnSync } from 'node:child_process';

const r = spawnSync(
	'pnpm',
	['exec', 'vitest', 'run', '--project', 'server', 'src/lib/server/store/pg-race.test.ts'],
	{ stdio: 'inherit', shell: true, env: { ...process.env, MANDATE_TEST_PG: '1' } }
);
process.exit(r.status ?? 1);
