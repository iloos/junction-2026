/**
 * The app's ports, built once per process. With DATABASE_URL: the Aiven pool, the Postgres catalog (seeded by
 * `pnpm db:seed`) and the Drizzle store on it. Without: PGlite in memory and the file catalog (offline demo).
 * Migrations are run by `pnpm db:migrate`, never at request time.
 */
import { publish as busPublish } from '$lib/server/bus';
import { createPgCatalog } from '../adapters/catalog/pg';
import { SimOverlay } from '../adapters/simulator/overlay';
import { createPgDb, dbMode } from '../db/client';
import { createDbPorts } from './db-ports';
import type { AnyDb } from './drizzle-store';

type Built = Awaited<ReturnType<typeof createDbPorts>>;
const g = globalThis as typeof globalThis & { __mandatePorts?: Promise<Built> };

/**
 * One instance per process (kept across Vite HMR), whoever asks first. It takes no options, so no caller's
 * wiring is lost to an earlier one: every committed transaction publishes its ops on the bus.
 */
export function createServerPorts(): Promise<Built> {
	g.__mandatePorts ??= build();
	return g.__mandatePorts;
}

const publish = (ws: string, events: Parameters<typeof busPublish>[1]) =>
	void busPublish(ws, events);

async function build(): Promise<Built> {
	if (dbMode() === 'fixture') return createDbPorts({ publish, followCurrentRun: true });
	const db = (await createPgDb({ runMigrations: false })) as unknown as AnyDb;
	const overlay = new SimOverlay();
	return createDbPorts({
		db,
		overlay,
		catalog: createPgCatalog(db, { overlay }),
		publish,
		followCurrentRun: true
	});
}
