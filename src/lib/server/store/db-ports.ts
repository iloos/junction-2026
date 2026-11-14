/**
 * Full ports on a database: Drizzle store + simulator stock + Valio catalog. PGlite (in memory) by default,
 * which is the fixture path for tests, evals and the offline demo; pass a Postgres-backed `db` for Aiven.
 */
import type { Kitchen, ServerEvent } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { Kitchen as KitchenSchema } from '$lib/core/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { createFixtureDb } from '../db/pglite';
import { simStock } from '../db/schema';
import { createSimulator } from '../adapters/simulator/stock';
import { scopedWorkspace, SimOverlay } from '../adapters/simulator/overlay';
import { createFixturePorts } from './fixture-ports';
import { createDrizzleStore, type AnyDb } from './drizzle-store';
import { drizzleMenuStore } from '../menu/pg';
import seedKitchens from '../../../../fixtures/seeds/kitchens.json';
import { EVENT_SEEDS } from '$lib/kitchen/events';
import { EventSeed } from '$lib/core/demand';
import type { ServicePorts } from '$lib/core/services/events';
import { SCENARIO, scenarioClock, scenarioDate } from '$lib/core/scenario';
import { currentRun, currentRunStartedAt, loadCurrentRun } from '../demo/run';

import { DEMO_WORKSPACE } from '../demo/workspaces';
export { DEMO_WORKSPACE };
export const DEMO_RUN = 'run-1';

/** Event seeds by id, one per kitchen that has one (core reads no files; handlers get them through ports.events). */
export function loadSeedEvents(): Record<string, EventSeed> {
	return Object.fromEntries(EVENT_SEEDS.map((e) => [e.id, EventSeed.parse(e)]));
}

export function loadSeedKitchens(): Kitchen[] {
	return seedKitchens.kitchens.map((k) => KitchenSchema.parse(k));
}

/**
 * Available to promise: what a quote shows is the supplier's known stock minus what this run's commits already
 * took (sim_stock), so a second kitchen quoting after the first committed sees the stock that is left, not
 * Valio's number from before. Applies to known amounts only; unknown and unlimited supply is left as it is.
 */
export function afterCommits(
	catalog: Catalog,
	db: AnyDb,
	runOf: (workspaceId: string) => string,
	defaultWorkspace: string
): Catalog {
	return {
		...catalog,
		async offers(ids, deliverBy) {
			const r = await catalog.offers(ids, deliverBy);
			const known = r.offers.filter(
				(o) => o.availability.kind === 'known' && o.availability.amount !== null
			);
			if (known.length === 0) return r;
			const ws = scopedWorkspace() ?? defaultWorkspace;
			const rows = await db
				.select({ productId: simStock.productId, available: simStock.available })
				.from(simStock)
				.where(
					and(
						eq(simStock.workspaceId, ws),
						eq(simStock.runId, runOf(ws)),
						inArray(
							simStock.productId,
							known.map((o) => o.productId)
						)
					)
				);
			const left = new Map(rows.map((x) => [x.productId, x.available]));
			return {
				...r,
				offers: r.offers.map((o) => {
					const a = o.availability;
					const rest = left.get(o.productId);
					if (rest === undefined || rest === null || a.kind !== 'known' || a.amount === null)
						return o;
					if (rest >= a.amount) return o;
					const taken = +(a.amount - rest).toFixed(3);
					return {
						...o,
						availability: {
							...a,
							kind: rest <= 0 ? 'out' : 'known',
							amount: Math.max(0, rest),
							provenance: {
								...a.provenance,
								note: `${a.provenance.note ? `${a.provenance.note}; ` : ''}${a.amount} at the supplier, ${taken} already committed in this run`
							}
						}
					};
				})
			};
		}
	};
}

export interface DbPortsOptions {
	db?: AnyDb;
	workspaceId?: string;
	runId?: string;
	kitchens?: Kitchen[];
	/** Simulator clock; default the scenario start (Mon 7 Dec 21:40 Helsinki). */
	now?: string;
	overlay?: SimOverlay;
	/** Catalog to use instead of the file catalog (e.g. createPgCatalog on Aiven). */
	catalog?: Catalog;
	/** The ops lane's bus; called after each committed transaction. */
	publish?: (workspaceId: string, events: ServerEvent[]) => void;
	/**
	 * Served app: the store follows the workspace's current run (reset starts a new one) and the
	 * clock is the scenario clock, ticking from the run's start. Tests and evals leave this off.
	 */
	followCurrentRun?: boolean;
}

export async function createDbPorts(o: DbPortsOptions = {}) {
	const workspaceId = o.workspaceId ?? DEMO_WORKSPACE;
	const runId = o.runId ?? DEMO_RUN;
	const now = o.now ?? SCENARIO.start;
	const db = o.db ?? ((await createFixtureDb()).db as unknown as AnyDb);
	const overlay = o.overlay ?? new SimOverlay();
	const base = createFixturePorts({ now, overlay, catalog: o.catalog });
	if (o.followCurrentRun) {
		await loadCurrentRun(db, workspaceId);
		// Each workspace's clock ticks from its own run's start: the call's workspace scope (serveTool, the kitchen
		// queue) picks it, the configured workspace outside a scope.
		base.clock = {
			now: () => scenarioClock(currentRunStartedAt(scopedWorkspace() ?? workspaceId)).at(Date.now())
		};
	}
	const live = o.followCurrentRun ?? false;
	const store = createDrizzleStore(db, {
		runOf: live ? (ws) => currentRun(ws) : () => runId,
		// Live: the newest run in the database is current; reading it also updates this process's view.
		...(live ? { currentRunUnderLock: (d: AnyDb, ws: string) => loadCurrentRun(d, ws) } : {}),
		now: () => base.clock.now(),
		publish: o.publish ?? (() => {})
	});
	await store.ensure({
		workspaceId,
		runId: live ? currentRun(workspaceId) : runId,
		kitchens: o.kitchens ?? loadSeedKitchens(),
		simStart: live ? SCENARIO.start : now
	});
	// Other workspaces (e.g. the judges' sandbox) are created with the seed kitchens on first use.
	const ensured = new Map<string, Promise<void>>([[workspaceId, Promise.resolve()]]);
	const ensureWorkspace = (ws: string) => {
		let p = ensured.get(ws);
		if (!p) {
			p = (async () => {
				if (live) await loadCurrentRun(db, ws);
				await store.ensure({
					workspaceId: ws,
					runId: live ? currentRun(ws) : runId,
					kitchens: o.kitchens ?? loadSeedKitchens(),
					simStart: live ? SCENARIO.start : now
				});
			})();
			p.catch(() => ensured.delete(ws));
			ensured.set(ws, p);
		}
		return p;
	};
	const transact = store.transact.bind(store);
	store.transact = async (ws, fn) => {
		await ensureWorkspace(ws);
		return transact(ws, fn);
	};
	const kitchens = store.kitchens.bind(store);
	store.kitchens = async (ws) => {
		await ensureWorkspace(ws);
		return kitchens(ws);
	};
	const today = () => scenarioDate(base.clock.now());
	const ports: ServicePorts = {
		...base,
		catalog: afterCommits(base.catalog, db, (ws) => (live ? currentRun(ws) : runId), workspaceId),
		store,
		// Stock rows are seeded from the catalogue's own answer, never from an already-reduced one.
		simulator: createSimulator(base.catalog, { today }),
		events: loadSeedEvents(),
		// Same database handle as the store: plan_event reads the proposals /request writes.
		menus: drizzleMenuStore(db as AnyDb)
	};
	return { ports, store, db, overlay: base.overlay, workspaceId, runId };
}
