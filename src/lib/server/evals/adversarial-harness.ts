/* eslint-disable @typescript-eslint/no-explicit-any -- probes reach into plan, task and event shapes across layers */
/**
 * The adversarial suites' shared setup (round 11 on): a hotel kitchen on PGlite with three synthetic 1 l milks (the
 * first lactose-free), a mutable catalogue port a probe can fail or reshape, the real handlers, a task store, and
 * helpers to place, grant and read orders. Not a test file; the suites import it.
 */
import { Offer, Product, SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { Plan } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { memoryTaskStore } from '$lib/server/tasks/store';

export const must = (r: any): any => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

/** `it` for a guarded case, `it.fails` for an open one named with its owner; `ADV_SHOW=1` runs all plainly. */
export function prober(it: any, open: Record<string, string>) {
	return (id: string, title: string, fn: () => Promise<void> | void, timeout = 120_000) => {
		const owner = open[id];
		if (owner && !process.env.ADV_SHOW) it.fails(`${id} [open · ${owner}] ${title}`, fn, timeout);
		else it(`${id} ${title}`, fn, timeout);
	};
}

const provenance = { source: 'seed' as const };
export const milks = ['100001', '100002', '100003'].map((productId, i) =>
	Product.parse({
		productId,
		nameFi: `Review milk ${i} 1 l`,
		nameEn: `milk ${i} 1 l`,
		category: '10000',
		categoryGroup: '10',
		isFood: true,
		vendor: 'Review',
		origin: 'fi',
		labels: [],
		temperatureClass: 'chilled',
		salesUnit: 'ST',
		baseUnit: 'ST',
		packs: [{ unit: 'ST', baseUnits: 1 }],
		lotStep: 1,
		catchWeight: false,
		netPerSalesUnit: { value: { value: 1, unit: 'l' }, provenance },
		// Ordinary milk declares milk (AM), as Valio's records do; the lactose-free one claims LACTOSE.
		allergens: { contains: i === 0 ? [] : ['AM'], mayContain: [], declared: true },
		freeFrom: i === 0 ? ['LACTOSE'] : [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: []
	})
);

let seq = 0;
/** One fresh workspace on `db` (a createFixtureDb() database shared per suite). */
export async function setup(db: unknown, products = milks) {
	const ws = `ws-adv-h-${++seq}`;
	const catalog: Catalog & Record<string, any> = {
		get: async (ids: string[]) =>
			new Map(products.filter((p) => ids.includes(p.productId)).map((p) => [p.productId, p])),
		search: async () => products,
		candidates: async () => [{ productId: '100002', fromValioRule: true }],
		offers: async (ids: string[], date: string) => ({
			notFound: [],
			offers: ids.map((productId) =>
				Offer.parse({
					productId,
					price: { unitCents: 100, comparison: null, taxRate: 14, validTo: null, provenance },
					availability: {
						kind: 'known',
						amount: 10000,
						logisticModel: 'Stock',
						availableDate: date,
						closingTime: `${date}T17:00:00+02:00`,
						raw: null,
						provenance
					}
				})
			)
		})
	} as any;
	const k = structuredClone(loadSeedKitchens().find((k) => k.id === 'k-hotel')!);
	k.usualProducts = products.map((p) => p.productId);
	k.constraints = {
		origin: [],
		allergens: { freeFrom: [], unknownCounts: 'hold' },
		tenderListOnly: false,
		labels: []
	};
	k.deliveryDays = ['mon', 'thu'];
	k.mandate = {
		...k.mandate,
		lineCapCents: 100000,
		orderCapCents: 100000,
		weeklyCapCents: 1000000,
		hardLimitCents: 2000000,
		neverDelegate: []
	};
	// The ports read the catalogue through these wrappers, so a probe can swap catalog.get/offers/search later.
	const port: Catalog = {
		get: (ids: any) => catalog.get(ids),
		search: (...a: any[]) => (catalog.search as any)(...a),
		candidates: (...a: any[]) => (catalog.candidates as any)(...a),
		offers: (ids: any, date: any) => catalog.offers(ids, date)
	} as Catalog;
	const b = await createDbPorts({
		db: db as never,
		workspaceId: ws,
		catalog: port,
		kitchens: [k],
		now: '2026-12-07T09:00:00+02:00'
	});
	const h = createHandlers(b.ports);
	const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
		workspaceId: ws,
		runId: 'run-1',
		actor: { kind, id: `adv-${kind}` },
		scopes: SCOPES_BY_ACTOR[kind],
		via: 'review'
	});
	const tasks = memoryTaskStore();
	const deps: any = {
		handlers: h,
		ctx: ctx('chef'),
		ports: { ...b.ports, tasks },
		workspaceId: ws,
		kitchen: { id: k.id },
		today: '2026-12-07'
	};
	const place = async (key = 'place', ids = ['100001']): Promise<Plan> =>
		must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: k.id,
				deliverBy: '2026-12-10',
				idempotencyKey: key,
				lines: ids.map((productId) => ({
					productId,
					qty: 4,
					unit: 'ST',
					amount: { value: 4, unit: 'l' as const }
				}))
			})
		).plan;
	const grant = async (planId: string) => {
		const a = must(await h.get_plan(ctx('chef'), { planId })).approval;
		if (!a || a.state !== 'pending') return;
		must(
			await h.approve(ctx('chef'), {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			})
		);
	};
	const state = () => b.store.load(ws, 'run-1');
	const orders = async () => Object.values((await state()).orders) as any[];
	const kitchen = async () => (await b.store.kitchens(ws))[0];
	return { b, h, ctx, tasks, deps, catalog, ws, place, grant, state, orders, kitchen };
}
