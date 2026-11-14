/**
 * Full ports on a database: Drizzle store + simulator stock + Valio catalog. PGlite (in memory) by default,
 * which is the fixture path for tests, evals and the offline demo; pass a Postgres-backed `db` for Aiven.
 */
import type { Kitchen, ServerEvent } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { Kitchen as KitchenSchema } from '$lib/core/contracts';
import { createFixtureDb } from '../db/pglite';
import { createSimulator } from '../adapters/simulator/stock';
import { SimOverlay } from '../adapters/simulator/overlay';
import { createFixturePorts } from './fixture-ports';
import { createDrizzleStore, type AnyDb } from './drizzle-store';
import seedKitchens from '../../../../fixtures/seeds/kitchens.json';
import buffetSeed from '../../../../fixtures/seeds/christmas-buffet-140.json';
import { EventSeed } from '$lib/core/demand';
import type { ServicePorts } from '$lib/core/services/events';
import { SCENARIO, scenarioClock } from '$lib/core/scenario';
import { currentRun, currentRunStartedAt, loadCurrentRun } from '../demo/run';

export const DEMO_WORKSPACE = 'ws-demo';
export const DEMO_RUN = 'run-1';

/** Event seeds by id (core reads no files; handlers get them through ports.events). */
export function loadSeedEvents(): Record<string, EventSeed> {
	const e = EventSeed.parse(buffetSeed);
	return { [String(buffetSeed.id)]: e };
}

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
	/** Catalog to use instead of the file catalog (e.g. createPgCatalog on Aiven). */
	catalog?: Catalog;
	/** The ops lane's bus; called after each committed transaction. */
	publish?: (workspaceId: string, events: ServerEvent[]) => void;
	/**
	 * Served app (R0-d): the store follows the workspace's current run (reset starts a new one) and the
	 * clock is the scenario clock, ticking from the run's start. Tests and evals leave this off.
	 */
	followCurrentRun?: boolean;
}

export async function createDbPorts(o: DbPortsOptions = {}) {
	const workspaceId = o.workspaceId ?? DEMO_WORKSPACE;
	const runId = o.runId ?? DEMO_RUN;
	const now = o.now ?? '2026-11-14T12:00:00+02:00';
	const db = o.db ?? ((await createFixtureDb()).db as unknown as AnyDb);
	const overlay = o.overlay ?? new SimOverlay();
	const base = createFixturePorts({ now, overlay, catalog: o.catalog });
	if (o.followCurrentRun) {
		await loadCurrentRun(db, workspaceId);
		base.clock = {
			now: () => scenarioClock(currentRunStartedAt(workspaceId)).at(Date.now())
		};
	}
	const live = o.followCurrentRun ?? false;
	const store = createDrizzleStore(db, {
		runOf: live ? (ws) => currentRun(ws) : () => runId,
		now: () => base.clock.now(),
		publish: o.publish ?? (() => {})
	});
	await store.ensure({
		workspaceId,
		runId: live ? currentRun(workspaceId) : runId,
		kitchens: o.kitchens ?? loadSeedKitchens(),
		simStart: live ? SCENARIO.start : now
	});
	const today = () =>
		new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(base.clock.now());
	const ports: ServicePorts = {
		...base,
		store,
		simulator: createSimulator(base.catalog, { today }),
		events: loadSeedEvents()
	};
	return { ports, store, db, overlay: base.overlay, workspaceId, runId };
}
