/**
 * The app's ports, built once per process. With DATABASE_URL: the Aiven pool, the Postgres catalog (seeded by
 * `pnpm db:seed`) and the Drizzle store on it, with cache-through to Valio's API when VALIO_API_KEY is set
 * (VALIO_LIVE=0 turns it off). Without: PGlite in memory and the file catalog (offline demo).
 * Migrations are run by `pnpm db:migrate`, never at request time.
 */
import { env } from '$env/dynamic/private';
import { publish as busPublish } from '$lib/server/bus';
import { createPgCatalog } from '../adapters/catalog/pg';
import { createValioLive } from '../adapters/catalog/valio-live';
import { logTrace } from '../adapters/llm/trace';
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

/**
 * After commit, best effort: a failed notification never fails the write (the op is durable), and open screens
 * get it on their next catch-up (a reconnect, or a run check's catch-up). Logged instead of left unhandled.
 */
const publish = (ws: string, events: Parameters<typeof busPublish>[1]) =>
	void busPublish(ws, events).catch((e) =>
		console.error(
			`[bus] publish failed for ${ws} (${events.length} events)`,
			e instanceof Error ? e.message : e
		)
	);

async function build(): Promise<Built> {
	if (dbMode() === 'fixture') return createDbPorts({ publish, followCurrentRun: true });
	const db = (await createPgDb({ runMigrations: false })) as unknown as AnyDb;
	const overlay = new SimOverlay();
	const live =
		env.VALIO_API_KEY && env.VALIO_LIVE !== '0'
			? createValioLive({
					apiKey: env.VALIO_API_KEY,
					baseUrl: env.VALIO_BASE_URL || undefined,
					onCall: (t) => logTrace({ source: t.api, model: t.purpose, ...t })
				})
			: undefined;
	return createDbPorts({
		db,
		overlay,
		catalog: createPgCatalog(db, { overlay, live }),
		publish,
		followCurrentRun: true
	});
}
