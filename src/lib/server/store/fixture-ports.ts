/**
 * Ports for the fixture path (tests, evals, offline demo): Valio cache-only catalog + simulator overlay + fixed clock.
 * Decide/Llm/Web/Jobs belong to other lanes; here they fail loudly so a test never depends on a model by accident.
 */
import type { Catalog, Ports } from '$lib/core/ports';
import { SCENARIO } from '$lib/core/scenario';
import { createValioCatalog } from '../adapters/catalog/valio';
import { SimOverlay } from '../adapters/simulator/overlay';

const unavailable = (port: string) => () => {
	throw new Error(`${port} port is not wired in fixture ports`);
};

let sharedCatalog: (Catalog & { products: Map<string, unknown> }) | null = null;
let sharedOverlay: SimOverlay | null = null;

export interface FixturePortsOptions {
	/** Simulator time; default: the scenario start (Mon 7 Dec 21:40 Helsinki). */
	now?: string;
	dir?: string;
	overlay?: SimOverlay;
	/** A catalog to use instead of the file catalog; the file catalog is then never loaded (production has no data/valio). */
	catalog?: Catalog;
	/** Partial overrides. */
	ports?: Partial<Ports>;
}

/** The catalogue is loaded once per process (≈17.5k products); overlays are per call site. */
export function createFixturePorts(o: FixturePortsOptions = {}): Ports & { overlay: SimOverlay } {
	const overlay = o.overlay ?? sharedOverlay ?? new SimOverlay();
	sharedOverlay ??= overlay;
	const catalog =
		o.catalog ?? (sharedCatalog ??= createValioCatalog({ dir: o.dir, overlay: sharedOverlay }));
	const now = new Date(o.now ?? SCENARIO.start);
	const base: Ports = {
		clock: { now: () => now },
		catalog,
		simulator: { consume: unavailable('simulator.consume'), events: () => [] },
		decide: {
			yesNo: unavailable('decide'),
			choice: unavailable('decide'),
			score: unavailable('decide')
		},
		llm: { generate: unavailable('llm') },
		web: { search: unavailable('web') },
		jobs: { enqueue: unavailable('jobs') },
		store: {
			transact: unavailable('store'),
			load: unavailable('store'),
			kitchens: unavailable('store'),
			idempotency: unavailable('store'),
			rememberResponse: unavailable('store'),
			lockBudget: unavailable('store'),
			addSpend: unavailable('store')
		},
		ops: { readAfter: unavailable('ops'), subscribe: unavailable('ops') }
	};
	return { ...base, ...o.ports, overlay: sharedOverlay };
}
