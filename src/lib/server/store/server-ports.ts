/**
 * The app's ports, built once per process. With DATABASE_URL: the Aiven pool, the Postgres catalog (seeded by
 * `pnpm db:seed`) and the Drizzle store on it. Without: PGlite in memory and the file catalog (offline demo).
 * Migrations are run by `pnpm db:migrate`, never at request time.
 */
import type { ServerEvent } from '$lib/core/contracts';
import { createPgCatalog } from '../adapters/catalog/pg';
import { SimOverlay } from '../adapters/simulator/overlay';
import { createPgDb, dbMode } from '../db/client';
import { createDbPorts } from './db-ports';
import type { AnyDb } from './drizzle-store';

type Built = Awaited<ReturnType<typeof createDbPorts>>;
const g = globalThis as typeof globalThis & { __mandatePorts?: Promise<Built> };

export interface ServerPortsOptions {
	/** The ops lane's bus: called after each committed transaction with one event per op. */
	publish?: (workspaceId: string, events: ServerEvent[]) => void;
}

/** One instance per process (kept across Vite HMR); later calls get the first build. */
export function createServerPorts(o: ServerPortsOptions = {}): Promise<Built> {
	g.__mandatePorts ??= build(o);
	return g.__mandatePorts;
}

async function build(o: ServerPortsOptions): Promise<Built> {
	if (dbMode() === 'fixture') return createDbPorts({ publish: o.publish, followCurrentRun: true });
	const db = (await createPgDb({ runMigrations: false })) as unknown as AnyDb;
	const overlay = new SimOverlay();
	return createDbPorts({
		db,
		overlay,
		catalog: createPgCatalog(db, { overlay }),
		publish: o.publish,
		followCurrentRun: true
	});
}
