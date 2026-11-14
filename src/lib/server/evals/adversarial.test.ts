/* eslint-disable @typescript-eslint/no-explicit-any -- probes reach into plan/task shapes across layers */
/**
 * Adversarial regression suite (docs/review/ROUND9-ADVERSARIAL.md, rounds 7–9). Every case asserts the CORRECT
 * behaviour. A case that still fails on main is listed in OPEN with its owner and runs as `it.fails`: green while the
 * defect stands, red ("looks fixed") once it is fixed, so the owner deletes its entry here and it guards from then on.
 * Real core handlers, store and reducer on PGlite with a small synthetic catalogue; Valio and Postgres NOTIFY are
 * faked (transport cases: adversarial-transport.test.ts). No network.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Kitchen, Offer, Product, SCOPES_BY_ACTOR, err } from '$lib/core/contracts';
import type { Plan } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { factsFor } from '$lib/core/services/views';
import { planFulfilment } from '$lib/core/mandate/fulfilment';
import { createFixtureDb } from '$lib/server/db/pglite';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { chatTurn } from '$lib/server/chat/turn';
import { project, projectedTaskStore } from '$lib/server/tasks/project';
import { createGetOutcome, readTask } from '$lib/server/tasks/outcome';
import { createValioLive } from '$lib/server/adapters/catalog/valio-live';
import { setCurrentRun } from '$lib/server/demo/run';
import { onCurrentRun } from '$lib/server/demo/reset';
import { runRequest } from '$lib/server/request/run';
import { computeOutcome } from '$lib/server/agent/outcome';
import { nextActionFor } from '$lib/server/agent/next-action';
import { trialWorkspace } from '$lib/server/agent/trial-harness';
import { attachStateSink, stateWrites } from '$lib/server/web/persist';
import { createWorkQueue } from '$lib/server/web/queue';
import { createFindings } from '$lib/server/web/findings';
import { drain } from '$lib/server/web/watch';
import { coverage } from '../../../routes/ops/cases';

/**
 * Open defects: id → owner. A listed case must still fail; once it passes, delete its line (the owner's fix lands
 * with that deletion). Owners: E = agent/chat, 8d = core, 9c = runtime/transport, D = web, lead = contracts.
 */
const OPEN: Record<string, string> = {
	'R9-08': '9c',
	'R7-03': '8d',
	'R7-05': '8d',
	'R7-11': '8d',
	'R8-web-write': 'D',
	'R8-queue-claim': 'D',
	'R8-next-action': 'E'
};
/**
 * `it` for a guarded case, `it.fails` for an open one, named with its owner. `ADV_SHOW=1` runs every case as a plain
 * `it`, so an owner sees why an open case fails (the defect, not a broken setup).
 */
function probe(id: string, title: string, fn: () => Promise<void> | void, timeout = 120_000) {
	const owner = OPEN[id];
	if (owner && !process.env.ADV_SHOW) it.fails(`${id} [open · ${owner}] ${title}`, fn, timeout);
	else it(`${id} ${title}`, fn, timeout);
}

const must = (r: any): any => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

// ---------------------------------------------------------------------------------------------- Round 9: chat tasks

let fx: Awaited<ReturnType<typeof createFixtureDb>>;
beforeAll(async () => {
	fx = await createFixtureDb();
});
afterAll(async () => {
	await fx.client.close();
});
let seq = 0;
const prov = { source: 'seed' as const };
const milks = ['100001', '100002', '100003'].map((productId, i) =>
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
		netPerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: prov },
		allergens: { contains: [], mayContain: [], declared: true },
		freeFrom: [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: []
	})
);
const milkCatalog: Catalog = {
	get: async (ids) =>
		new Map(milks.filter((p) => ids.includes(p.productId)).map((p) => [p.productId, p])),
	search: async () => milks,
	candidates: async () => [],
	offers: async (ids, date) => ({
		notFound: [],
		offers: ids.map((productId) =>
			Offer.parse({
				productId,
				price: { unitCents: 100, comparison: null, taxRate: 14, validTo: null, provenance: prov },
				availability: {
					kind: 'known',
					amount: 10000,
					logisticModel: 'Stock',
					availableDate: date,
					closingTime: `${date}T17:00:00+02:00`,
					raw: null,
					provenance: prov
				}
			})
		)
	})
} as Catalog;

/**
 * A hotel kitchen; 100001 is usual, the rest are new (held for a chef). It receives on Thursdays (the probes'
 * delivery day) unless `days` says otherwise: R9-06 gives it Mondays only.
 */
async function chatSetup(days: Kitchen['deliveryDays'] = ['mon', 'thu']) {
	const ws = `ws-adv-${++seq}`;
	const k = structuredClone(loadSeedKitchens().find((k) => k.id === 'k-hotel')!);
	k.usualProducts = ['100001'];
	k.constraints = {
		origin: [],
		allergens: { freeFrom: [], unknownCounts: 'hold' },
		tenderListOnly: false,
		labels: []
	};
	k.deliveryDays = days;
	k.mandate = {
		...k.mandate,
		lineCapCents: 100000,
		orderCapCents: 100000,
		weeklyCapCents: 1000000,
		hardLimitCents: 2000000,
		neverDelegate: ['new_sku']
	};
	const b = await createDbPorts({
		db: fx.db as never,
		workspaceId: ws,
		catalog: milkCatalog,
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
	const place = async (ids: string[], key = 'place'): Promise<Plan> =>
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
	const task = async (plans: Plan[]) =>
		must(
			await tasks.put(
				{
					workspaceId: ws,
					runId: 'run-1',
					id: `task-adv-${seq}`,
					kitchenId: k.id,
					title: 'review',
					createdBy: ctx('chef').actor,
					createdAt: b.ports.clock.now().toISOString(),
					updatedAt: b.ports.clock.now().toISOString(),
					version: 0,
					requirement: { goal: '4 l milk for Thursday' },
					slots: {},
					plans: plans.map((p, i) => ({
						planId: p.id,
						versionSeen: p.version,
						role: i === 0 ? 'primary' : 'touched'
					})),
					runs: [],
					pending: { kind: 'none' },
					state: 'open'
				} as any,
				null
			)
		);
	const grant = async (planId: string, lineIds?: string[]) => {
		const a = must(await h.get_plan(ctx('chef'), { planId })).approval!;
		return must(
			await h.approve(ctx('chef'), {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant',
				...(lineIds ? { lineIds } : {})
			})
		);
	};
	const state = () => b.store.load(ws, 'run-1');
	return { b, h, ctx, tasks, deps, place, task, grant, ws, state };
}
const lineState = (s: any, planId: string, productId: string) =>
	s.plans[planId].lines.find((l: any) => l.productId === productId)!.state;

describe('suite: adversarial (round 9: tasks, commands, transport)', () => {
	probe('R9-01', 'a grant after a partial continue buys the newly granted line', async () => {
		const s = await chatSetup();
		const p = await s.place(['100001', '100002']);
		const t = await s.task([p]);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		await s.grant(p.id);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		const st = await s.state();
		expect(lineState(st, p.id, '100002')).toBe('committed');
		// Each line is in at most one purchase.
		const bought = Object.values(st.receipts as Record<string, any>).flatMap((r) =>
			r.confirmed.map((c: any) => c.lineId ?? c.productId)
		);
		expect(new Set(bought).size).toBe(bought.length);
	});

	probe('R9-02', 'a cancelled task orders nothing through a stale continue', async () => {
		const s = await chatSetup();
		const p = await s.place(['100002']);
		const t = await s.task([p]);
		await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
		await s.grant(p.id);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(Object.values((await s.state()).orders)).toHaveLength(0);
		expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
	});

	probe(
		'R9-03',
		'"make it 20 kg" on a litre line never buys 20 l and keeps need = purchase',
		async () => {
			const s = await chatSetup();
			const p = await s.place(['100002']);
			const t = await s.task([p]);
			await chatTurn({ taskId: t.id, text: 'make it 20 kg' }, s.deps);
			const now = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
			expect(now.lines[0].view!.physical).not.toMatchObject({ value: 20, unit: 'l' });
			expect(now.lines[0].view!.physical).toMatchObject(now.needs[0].amount);
		}
	);

	probe(
		'R9-04',
		'a task is not done while a second plan awaits approval, and continue buys it once granted',
		async () => {
			const s = await chatSetup();
			const p1 = await s.place(['100001'], 'p1');
			const p2 = await s.place(['100002'], 'p2');
			must(
				await s.h.commit_order(s.ctx('kitchen_agent'), {
					planId: p1.id,
					version: p1.version,
					idempotencyKey: 'c1'
				})
			);
			const t = await s.task([p1, p2]);
			const read = must(await readTask(s.ctx('chef'), s.b.ports, s.h, [p1.id, p2.id]));
			const projected = project(t, read);
			expect(projected.task.state).not.toBe('done');
			expect(projected.task.pending.kind).not.toBe('none');
			await s.grant(p2.id);
			await chatTurn({ taskId: t.id, continue: true }, s.deps);
			expect(lineState(await s.state(), p2.id, '100002')).toBe('committed');
		}
	);

	probe('R9-05', 'a granted reason group continues while another group stays pending', async () => {
		const s = await chatSetup();
		const p = await s.place(['100002', '100003']);
		const t = await s.task([p]);
		await s.grant(p.id, [p.lines[0].id]);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		const st = await s.state();
		expect(lineState(st, p.id, p.lines[0].productId)).toBe('committed');
		expect(lineState(st, p.id, p.lines[1].productId)).not.toBe('committed');
	});

	probe(
		'R9-06',
		"the shared gate never commits a delivery outside the kitchen's receiving days",
		async () => {
			const s = await chatSetup(['mon']);
			const p = await s.place(['100001']); // Thu 10 Dec; the kitchen receives on Mondays only
			const c = await s.h.commit_order(s.ctx('kitchen_agent'), {
				planId: p.id,
				version: p.version,
				idempotencyKey: 'c'
			});
			expect(c.ok && c.value.committedLineIds.length > 0).toBe(false);
			// Held for the calendar, not for some other reason; and the same order on a receiving day commits.
			const held = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan.lines[0];
			expect(held.reasons ?? []).toContain('off_delivery_day');
			const ok = await chatSetup(['mon', 'thu']);
			const q = await ok.place(['100001']);
			const control = must(
				await ok.h.commit_order(ok.ctx('kitchen_agent'), {
					planId: q.id,
					version: q.version,
					idempotencyKey: 'c'
				})
			);
			expect(control.committedLineIds).toHaveLength(1);
		}
	);

	probe('R9-07', 'one Valio adapter never exceeds its four-call bound across callers', async () => {
		let active = 0;
		let max = 0;
		const live = createValioLive({
			apiKey: 'fake',
			retries: 0,
			fetch: async () => {
				active++;
				max = Math.max(max, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return new Response(JSON.stringify({ products: [] }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
		} as any);
		// Twelve different ids, so coalescing identical misses can't be what keeps the count down.
		await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				live.fetch('availability', [String(200001 + i)], '2026-12-10')
			)
		);
		expect(max).toBeGreaterThan(0);
		expect(max).toBeLessThanOrEqual(4);
	});

	probe('R9-08', 'run normalisation moves a stale context onto the known current run', async () => {
		const workspaceId = 'ws-j-adv0000000000000000000001';
		setCurrentRun(workspaceId, 'run-new');
		const ctx: CallContext = {
			workspaceId,
			runId: 'run-old',
			actor: { kind: 'external_agent', id: 'adv' },
			scopes: ['read', 'plan', 'order'],
			via: 'review'
		} as CallContext;
		expect((await onCurrentRun(ctx)).runId).toBe('run-new');
	});
});

// ------------------------------------------------------------------------------------ Round 7: the purchase asked for

const source = { source: 'team_estimate', note: 'adversarial synthetic fixture' };
const milk = (productId: string, nameFi: string, lactoseFree: boolean) =>
	Product.parse({
		productId,
		nameFi,
		category: '10400',
		categoryGroup: '10',
		isFood: true,
		vendor: 'Review fixture',
		origin: 'fi',
		labels: [],
		temperatureClass: 'chilled',
		salesUnit: 'ST',
		baseUnit: 'ST',
		packs: [{ unit: 'ST', baseUnits: 1 }],
		lotStep: 1,
		catchWeight: false,
		netPerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: source },
		reliability: 1,
		allergens: { contains: ['MILK'], mayContain: [], declared: true },
		freeFrom: lactoseFree ? ['LACTOSE'] : [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: []
	});
const rctx = (kind = 'kitchen_agent') =>
	({
		workspaceId: 'ws-demo',
		runId: 'run-1',
		actor: { kind, id: kind + '-adv' },
		scopes: SCOPES_BY_ACTOR[kind as keyof typeof SCOPES_BY_ACTOR],
		via: 'review'
	}) as any;

async function r7() {
	let offerPrice = 100;
	let supplyKind = 'known';
	const products = new Map([
		['464201', milk('464201', 'Review kevytmaito laktoositon 1 l', true)],
		['470418', milk('470418', 'Review kevytmaito 1 l', false)],
		['470419', milk('470419', 'Review other maito 1 l', false)]
	]);
	const kitchen = Kitchen.parse({
		id: 'k-hotel',
		profile: 'review',
		name: 'Review kitchen',
		kind: 'hotel',
		city: 'Espoo',
		size: {},
		deliveryDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
		weights: { price: 1 },
		constraints: {
			origin: [],
			allergens: { freeFrom: [], unknownCounts: 'reject' },
			tenderListOnly: false,
			labels: []
		},
		mandate: {
			version: 1,
			words: 'Review test',
			lineCapCents: 100000,
			orderCapCents: 100000,
			weeklyCapCents: 500000,
			hardLimitCents: 1000000,
			neverDelegate: []
		},
		factorSensitivity: {},
		usualProducts: [...products.keys()]
	});
	const ports: any = {
		clock: { now: () => new Date('2026-12-07T10:00:00Z') },
		catalog: {
			get: async (ids: string[]) =>
				new Map(ids.filter((id) => products.has(id)).map((id) => [id, products.get(id)])),
			search: async () => [...products.values()],
			candidates: async () => [{ productId: '470418', fromValioRule: true }],
			offers: async (ids: string[], deliverBy: string) => ({
				offers: ids.map((productId) => ({
					productId,
					price: {
						unitCents: offerPrice,
						comparison: { cents: offerPrice, unit: 'l' },
						taxRate: 13.5,
						validTo: null,
						provenance: source
					},
					availability: {
						kind: supplyKind,
						amount: supplyKind === 'known' ? 100 : null,
						logisticModel: supplyKind === 'known' ? 'Stock' : 'Terminal',
						availableDate: deliverBy,
						closingTime: '2026-12-09T17:00:00+02:00',
						raw: 100,
						provenance: source
					}
				})),
				notFound: []
			})
		},
		decide: {
			score: async () => ({
				value: 0,
				source: 'gemini',
				confidence: 0.9,
				model: 'synthetic-review',
				latencyMs: 1
			})
		},
		llm: {},
		web: {},
		ops: {}
	};
	const built = await createDbPorts({
		catalog: ports.catalog,
		kitchens: [kitchen],
		now: '2026-12-07T10:00:00Z'
	});
	ports.store = built.ports.store;
	ports.simulator = built.ports.simulator;
	const h = createHandlers(ports);
	const place = async (key: string, actor = 'kitchen_agent') =>
		must(
			await h.place_order(rctx(actor), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: key,
				lines: [{ productId: '464201', qty: 10, unit: 'ST', amount: { value: 10, unit: 'l' } }]
			})
		).plan;
	return {
		ports,
		h,
		place,
		products,
		kitchen,
		state: () => ports.store.load('ws-demo', 'run-1'),
		price: (n: number) => {
			offerPrice = n;
		},
		supply: (kind: string) => {
			supplyKind = kind;
		}
	};
}

describe('suite: adversarial (round 7: the purchase the chef asked for)', () => {
	probe('R7-01', 'a lactose-free request is never bought as ordinary milk', async () => {
		const { h, kitchen, products } = await r7();
		const r = await runRequest('10 litres of lactose-free milk for December 10', {
			handlers: h,
			ctx: rctx(),
			kitchen,
			today: '2026-12-07',
			llm: null,
			llmKind: 'fixture',
			nonce: 'diet-request'
		} as any);
		const p = r.order!.plan;
		const sub = await h.find_substitutes(rctx(), {
			planId: p.id,
			version: p.version,
			lineId: p.lines[0].id,
			apply: true
		});
		// The need keeps the request's requirement, whatever happens to its lines.
		expect(p.needs[0].requirements?.freeFrom).toContain('LACTOSE');
		// Refusing the substitution is correct; choosing ordinary milk must not survive to a commit either way.
		if (sub.ok) {
			const wrong = sub.value.chosen.filter(
				(c: any) => !products.get(c.productId)!.freeFrom.includes('LACTOSE')
			);
			if (wrong.length) {
				const c = await h.commit_order(rctx(), {
					planId: p.id,
					version: sub.value.plan.version,
					idempotencyKey: 'diet-lost-commit',
					lineIds: wrong.map((w: any) => w.id)
				});
				expect(c.ok && c.value.committedLineIds.length > 0).toBe(false);
			}
		}
		// Whatever the plan holds now, committing all of it buys only lactose-free milk.
		const now = must(await h.get_plan(rctx(), { planId: p.id })).plan;
		await h.commit_order(rctx(), {
			planId: p.id,
			version: now.version,
			idempotencyKey: 'diet-all'
		});
		const final = must(await h.get_plan(rctx(), { planId: p.id })).plan;
		const bought = final.lines.filter((l: any) => l.state === 'committed');
		for (const l of bought) expect(products.get(l.productId)!.freeFrom).toContain('LACTOSE');
	});

	probe(
		'R7-02',
		'a substitute replaces the original: one 10 l need buys 10 l, not 20',
		async () => {
			const { h, place } = await r7();
			const p = await place('replace');
			const r = must(
				await h.find_substitutes(rctx(), {
					planId: p.id,
					version: p.version,
					lineId: p.lines[0].id,
					apply: true
				})
			);
			must(
				await h.commit_order(rctx(), {
					planId: p.id,
					version: r.plan.version,
					idempotencyKey: 'replace-commit'
				})
			);
			const final = must(await h.get_plan(rctx(), { planId: p.id })).plan;
			const f = final.view.fulfilment[0];
			expect(f.excess.value).toBe(0);
			// The 10 l is still bought, once: by one line, not zero and not two.
			expect(f.supplierConfirmed.value + f.awaitingSupplier.value).toBe(10);
			expect(final.lines.filter((l: any) => l.state === 'committed')).toHaveLength(1);
		}
	);

	probe(
		'R7-03',
		'supply that turns unknown after approval is not left reading "known, nothing to do"',
		async () => {
			const { h, place, supply } = await r7();
			const p = await place('supply-drift', 'external_agent');
			const a = must(await h.get_plan(rctx(), { planId: p.id })).approval;
			must(
				await h.approve(rctx('chef'), {
					approvalId: a.id,
					planVersion: a.planVersion,
					termsHash: a.termsHash,
					decision: 'grant'
				})
			);
			supply('unknown');
			const c = await h.commit_order(rctx('external_agent'), {
				planId: p.id,
				version: p.version,
				idempotencyKey: 'supply-drift-commit'
			});
			const final = must(await h.get_plan(rctx(), { planId: p.id }));
			// Either the commit asks again, or the stored line carries the fresh supply evidence.
			if (c.ok) expect(final.plan.lines[0].offer.availability.kind).toBe('unknown');
			expect(coverage([final.plan])).not.toEqual({ covered: 1, total: 1 });
		}
	);

	probe('R7-04', 'doubling the rice in a porridge doubles its dependent milk', async () => {
		const built = await createDbPorts();
		built.overlay.clear();
		const h = createHandlers(built.ports);
		const p = must(
			await h.plan_event(rctx('chef'), { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		).plan;
		const rice = p.needs.find((n: any) => /rice porridge.*rice/i.test(n.label));
		const milkNeed = p.needs.find((n: any) => /rice porridge.*milk/i.test(n.label));
		const r = must(
			await h.edit_line(rctx('chef'), {
				planId: p.id,
				version: p.version,
				needId: rice.id,
				patch: { gramsPerGuest: 200 }
			})
		).plan;
		const ratio = r.needs.find((n: any) => n.id === rice.id).amount.value / rice.amount.value;
		expect(ratio).toBeGreaterThan(1.2); // the edit took: milk following an unchanged rice proves nothing
		expect(r.needs.find((n: any) => n.id === milkNeed.id).amount.value).toBeCloseTo(
			milkNeed.amount.value * ratio
		);
	});

	// Policy (lead): a model never overrides deterministic eligibility; a 0/4 fit is a visible caution that holds
	// the line for a chef's sign-off and is never committed within the mandate.
	probe(
		'R7-05',
		'a substitute the model scores 0/4 for fit is held with a caution, never auto-committed',
		async () => {
			const { ports, h, place } = await r7();
			ports.catalog.candidates = async () =>
				['470418', '470419'].map((productId) => ({ productId, fromValioRule: true }));
			const p = await place('fit');
			const r = must(
				await h.find_substitutes(rctx(), {
					planId: p.id,
					version: p.version,
					lineId: p.lines[0].id,
					apply: true
				})
			);
			const ids = r.chosen.map((c: any) => c.id);
			const lines = r.plan.lines.filter((l: any) => ids.includes(l.id));
			for (const l of lines)
				expect((l.reasons ?? []).some((x: string) => x.startsWith('CAUTION.'))).toBe(true);
			const c = await h.commit_order(rctx(), {
				planId: p.id,
				version: r.plan.version,
				idempotencyKey: 'fit-commit'
			});
			const committed = c.ok ? c.value.committedLineIds : [];
			expect(committed.filter((id: string) => ids.includes(id))).toEqual([]);
		}
	);

	probe('R7-11', 'a one-unit receipt confirms one unit, not the whole ten-unit line', async () => {
		const { h, place, state, products } = await r7();
		const p = await place('receipt');
		must(
			await h.commit_order(rctx(), {
				planId: p.id,
				version: p.version,
				idempotencyKey: 'receipt-first'
			})
		);
		const s = structuredClone(await state()) as any;
		(Object.values(s.receipts)[0] as any).confirmed[0].qty.value = 1;
		const plan = must(await h.get_plan(rctx(), { planId: p.id })).plan;
		const f = planFulfilment(plan, factsFor(plan, products as any, undefined, s));
		expect(f[0].supplierConfirmed.value).toBe(1);
	});

	// Guards: these held at round 9; they must keep holding.
	it('a fully committed plan refuses a new repair (STALE_VERSION)', async () => {
		const { h, place } = await r7();
		const p = await place('already');
		must(
			await h.commit_order(rctx(), {
				planId: p.id,
				version: p.version,
				idempotencyKey: 'already-first'
			})
		);
		const r = await h.find_substitutes(rctx(), {
			planId: p.id,
			version: p.version,
			lineId: p.lines[0].id,
			apply: true
		});
		expect(r.ok ? 'ok' : r.error.code).toBe('STALE_VERSION');
	});

	it('a same-key commit replays its receipt; an outside agent cannot approve', async () => {
		const { h, place } = await r7();
		const p = await place('invariants');
		const input = { planId: p.id, version: p.version, idempotencyKey: 'repeat' };
		expect(must(await h.commit_order(rctx(), input))).toEqual(
			must(await h.commit_order(rctx(), input))
		);
		const external = await place('external', 'external_agent');
		const a = must(await h.get_plan(rctx(), { planId: external.id })).approval;
		const denied = await h.approve(rctx('external_agent'), {
			approvalId: a.id,
			planVersion: a.planVersion,
			termsHash: a.termsHash,
			decision: 'grant'
		});
		expect(denied.ok).toBe(false);
	});

	it('a changed price refuses a granted order with TERMS_CHANGED', async () => {
		const { h, place, price } = await r7();
		const p = await place('price-drift', 'external_agent');
		const a = must(await h.get_plan(rctx(), { planId: p.id })).approval;
		must(
			await h.approve(rctx('chef'), {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			})
		);
		price(110);
		const r = await h.commit_order(rctx('external_agent'), {
			planId: p.id,
			version: p.version,
			idempotencyKey: 'price-drift-commit'
		});
		expect(r.ok ? 'ok' : r.error.code).toBe('TERMS_CHANGED');
	});

	it('a request answered "awaiting supplier" is partial, not fulfilled, and keeps its 10 l', async () => {
		const { h, kitchen, supply } = await r7();
		supply('unknown');
		const request = await runRequest('10 litres of lactose-free milk for December 10', {
			handlers: h,
			ctx: rctx(),
			kitchen,
			today: '2026-12-07',
			llm: null,
			llmKind: 'fixture',
			nonce: 'awaiting-request'
		} as any);
		const p = request.order!.plan;
		expect(p.needs[0].amount).toEqual({ value: 10, unit: 'l' });
		const a = must(await h.get_plan(rctx(), { planId: p.id })).approval;
		must(
			await h.approve(rctx('chef'), {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			})
		);
		must(
			await h.commit_order(rctx(), {
				planId: p.id,
				version: p.version,
				idempotencyKey: 'awaiting-request-commit'
			})
		);
		const final = must(await h.get_plan(rctx(), { planId: p.id }));
		const outcome = computeOutcome({
			intent: 'routine_order',
			plan: final.plan,
			approval: final.approval
		} as any);
		expect(outcome.status).toBe('partial');
		expect(outcome.confirmedNeeds).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------- Round 8: identity, durability, reads

/** k-lounas receives Mon/Wed/Fri: the probes order for Friday, so the calendar hold (R9-06) never answers for them. */
async function chatDeps() {
	const w = await trialWorkspace();
	(w.env.ports as any).clock = { now: () => new Date('2026-12-07T10:00:00Z') };
	const deps: any = {
		handlers: w.handlers,
		ctx: w.ctx('chef'),
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen: { id: 'k-lounas' },
		today: '2026-12-07'
	};
	return { w, deps };
}

describe('suite: adversarial (round 8: identity, durability, reads)', () => {
	probe('R8-grant', "a context granted one kitchen can't read or order for another", async () => {
		const w = await trialWorkspace();
		const chef = w.ctx('chef');
		const restricted = { ...chef, kitchenIds: ['k-hotel'] } as any;
		const p = must(
			await w.handlers.place_order(chef, {
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-11',
				idempotencyKey: 'grant-initial',
				lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
			})
		).plan;
		expect((await w.handlers.get_plan(restricted, { planId: p.id })).ok).toBe(false);
		expect((await createGetOutcome(w.env.ports, w.handlers)(restricted, { planId: p.id })).ok).toBe(
			false
		);
		const placed = await w.handlers.place_order(restricted, {
			kitchenId: 'k-lounas',
			deliverBy: '2026-12-11',
			idempotencyKey: 'grant-disallowed',
			lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
		});
		expect(placed.ok).toBe(false);
	});

	probe(
		'R8-task-intent',
		'two new tasks with the same words are two purchases, not one',
		async () => {
			const { deps } = await chatDeps();
			const one = await chatTurn({ text: 'Order 4 l lactose-free milk for Friday' }, deps);
			const two = await chatTurn({ text: 'Order 4 l lactose-free milk for Friday' }, deps);
			const tasks = await Promise.all(
				[one.at(-1)!.taskId, two.at(-1)!.taskId].map((id) =>
					deps.ports.tasks!.get(deps.workspaceId, id)
				)
			);
			expect(tasks[0]!.id).not.toBe(tasks[1]!.id);
			expect(tasks[0]!.plans[0].planId).not.toBe(tasks[1]!.plans[0].planId);
		}
	);

	probe('R8-task-write', 'when the task cannot be saved, no order is placed', async () => {
		const { w, deps } = await chatDeps();
		const store = memoryTaskStore();
		const ports = {
			...deps.ports,
			tasks: { ...store, put: async () => err('STALE_VERSION', 'injected lost task write') }
		};
		await chatTurn({ text: 'Order 4 l lactose-free milk for Friday' }, { ...deps, ports });
		expect(Object.keys((await w.state()).orders)).toHaveLength(0);
	});

	probe(
		'R8-web-write',
		'a failed web-state write is retried, not acknowledged and dropped',
		async () => {
			let writes = 0;
			const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
			try {
				attachStateSink({
					upsert: async () => {
						writes++;
						throw new Error('injected database outage');
					},
					remove: async () => {}
				} as any);
				const queue = createWorkQueue();
				queue.add({ kind: 'notice', url: 'https://example.invalid/adv-durable' } as any);
				await stateWrites().catch(() => undefined);
				queue.add({ kind: 'notice', url: 'https://example.invalid/adv-durable' } as any);
				await stateWrites().catch(() => undefined);
				expect(writes).toBeGreaterThan(1);
			} finally {
				attachStateSink(null);
				logged.mockRestore();
			}
		}
	);

	probe(
		'R8-queue-claim',
		'a claimed queue item is worked even when this instance never saw it',
		async () => {
			const readNotice = vi.fn(async () => {
				throw new Error('read attempted');
			});
			await drain({
				queue: createWorkQueue(undefined, true),
				findings: createFindings(undefined, true),
				scope: { workspaceId: 'ws-demo', runId: 'run-1' },
				store: {} as any,
				index: {} as any,
				recalls: { mode: 'fixture', readNotice } as any,
				claim: async () => ['notice:https://example.invalid/queued-on-another-instance'],
				release: vi.fn(async () => {})
			} as any).catch(() => undefined);
			expect(readNotice).toHaveBeenCalled();
		}
	);

	probe(
		'R8-next-action',
		'a held line a chef already approved is next to commit, not "wait for a chef"',
		() => {
			const next = nextActionFor({
				id: 'p',
				version: 1,
				lines: [{ id: 'l', productId: '464201', state: 'held', view: { committable: true } }]
			} as any);
			expect(next.kind).not.toBe('chef');
		}
	);

	probe('R8-task-read', 'the open task list and the task detail agree on its state', async () => {
		const { w, deps } = await chatDeps();
		const out = await chatTurn({ text: 'Order 4 l lactose-free milk for Friday' }, deps);
		const taskId = out.at(-1)!.taskId;
		const stored = await deps.ports.tasks!.get(deps.workspaceId, taskId);
		const inner = memoryTaskStore();
		must(await inner.put({ ...stored!, state: 'awaiting_chef' }, null));
		const wrapped = projectedTaskStore(inner, deps.ports, w.handlers);
		const detail = await wrapped.get(deps.workspaceId, taskId);
		const list = await wrapped.list(deps.workspaceId, { open: true });
		const listed = list.find((t: any) => t.id === taskId);
		expect(listed?.state ?? 'not listed').toBe(
			detail!.state === 'done' ? 'not listed' : detail!.state
		);
	});

	it('a mixed-unit ledger keeps "2 kg + 3 l" apart', async () => {
		const { ledgerSummary } = await import('$lib/server/tasks/outcome');
		const bucket = (unit: string, n: number) => ({
			required: { value: n, unit },
			supplierConfirmed: { value: 0, unit },
			awaitingSupplier: { value: 0, unit },
			plannedKnown: { value: n, unit },
			plannedUnknown: { value: 0, unit },
			unresolved: { value: 0, unit },
			excess: { value: 0, unit }
		});
		const summary = ledgerSummary({
			asOf: '2026-12-07T10:00:00Z',
			needs: [
				{ needId: 'flour', planId: 'p', label: 'Flour', ...bucket('kg', 2) },
				{ needId: 'milk', planId: 'p', label: 'Milk', ...bucket('l', 3) }
			],
			receiptIds: [],
			committedCents: 0,
			decisionsLeft: 0,
			nextAction: 'Review.'
		} as any);
		expect(summary).toContain('2 kg + 3 l needed');
	});
});
