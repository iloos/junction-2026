/**
 * Full ports on a database: Drizzle store + simulator stock + Valio catalog. PGlite (in memory) by default,
 * which is the fixture path for tests, evals and the offline demo; pass a Postgres-backed `db` for Aiven.
 */
import type { Kitchen, ServerEvent } from '$lib/core/contracts';
import { Kitchen as KitchenSchema } from '$lib/core/contracts';
import type { Ports } from '$lib/core/ports';
import { createFixtureDb } from '../db/pglite';
import { createSimulator } from '../adapters/simulator/stock';
import { SimOverlay } from '../adapters/simulator/overlay';
import { createFixturePorts } from './fixture-ports';
import { createDrizzleStore, type AnyDb } from './drizzle-store';
import seedKitchens from '../../../../fixtures/seeds/kitchens.json';

export const DEMO_WORKSPACE = 'ws-demo';
export const DEMO_RUN = 'run-1';

export function loadSeedKitchens(): Kitchen[] {
	return seedKitchens.kitchens.map((k) => KitchenSchema.parse(k));
}

export interface DbPortsOptions {
	db?: AnyDb;
	workspaceId?: string;
	runId?: string;
	kitchens?: Kitchen[];
	/** Simulator clock; default Sat 14 Nov 2026 12:00 Helsinki. */
	now?: string;
	overlay?: SimOverlay;
	/** The ops lane's bus; called after each committed transaction. */
	publish?: (workspaceId: string, events: ServerEvent[]) => void;
}

export async function createDbPorts(o: DbPortsOptions = {}) {
	const workspaceId = o.workspaceId ?? DEMO_WORKSPACE;
	const runId = o.runId ?? DEMO_RUN;
	const now = o.now ?? '2026-11-14T12:00:00+02:00';
	const db = o.db ?? ((await createFixtureDb()).db as unknown as AnyDb);
	const overlay = o.overlay ?? new SimOverlay();
	const base = createFixturePorts({ now, overlay });
	const store = createDrizzleStore(db, {
		runOf: () => runId,
		now: base.clock.now,
		publish: o.publish ?? (() => {})
	});
	await store.ensure({
		workspaceId,
		runId,
		kitchens: o.kitchens ?? loadSeedKitchens(),
		simStart: now
	});
	const today = () =>
		new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(base.clock.now());
	const ports: Ports = { ...base, store, simulator: createSimulator(base.catalog, { today }) };
	return { ports, store, db, overlay: base.overlay, workspaceId, runId };
}
