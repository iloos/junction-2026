/* eslint-disable @typescript-eslint/no-explicit-any -- probes reach into plan, task and event shapes across layers */
/**
 * Adversarial regression suite, round 10 (docs/review/ROUND10-ADVERSARIAL.md; probes from scratch/round10). Same
 * convention as adversarial.test.ts: every case asserts the CORRECT behaviour; an open one runs as `it.fails` under
 * its owner until it is fixed (then it goes red and the owner deletes its OPEN line). `ADV_SHOW=1` runs all plainly.
 * Synthetic catalogue (three 1 l milks, the first lactose-free) on PGlite with the real core, chat, menu, grounding,
 * calendar and agent code. R10-09 (transport ordering) is in adversarial-transport.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MenuProposal, Offer, Product, SCOPES_BY_ACTOR, ok } from '$lib/core/contracts';
import type { Plan } from '$lib/core/contracts';
import type { CallContext, Catalog } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { rescueContention } from '$lib/core/services/contention';
import { fulfilmentOf } from '$lib/core/mandate/fulfilment';
import { buildCalendar } from '$lib/core/calendar';
import { createFixtureDb } from '$lib/server/db/pglite';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { chatTurn } from '$lib/server/chat/turn';
import { memoryMenuStore } from '$lib/server/menu/store';
import { acceptMenu } from '$lib/server/menu/flow';
import { createFindings } from '$lib/server/web/findings';
import { createFixtureFactSearch } from '$lib/server/web/fixture';
import { groundingFor, resetGrounding, startGrounding } from '$lib/server/web/grounding';
import { withServerKey } from '$lib/server/agent/loop';
import { answerQuestion } from '$lib/server/agent/intents/questions';
import { toolsFor } from '$lib/server/tools/serve';
import { GET as agentCard } from '../../../routes/.well-known/agent.json/+server';

/** Open defects: id → owner. Delete a line when its case goes red ("looks fixed"). R10-07 and R10-16 were fixed on main
 * before this suite landed: they run as guards. */
const OPEN: Record<string, string> = {
	'R10-05': '8d',
	'R10-06': '8d',
	'R10-08': '8d'
};
function probe(id: string, title: string, fn: () => Promise<void> | void, timeout = 120_000) {
	const owner = OPEN[id];
	if (owner && !process.env.ADV_SHOW) it.fails(`${id} [open · ${owner}] ${title}`, fn, timeout);
	else it(`${id} ${title}`, fn, timeout);
}
const must = (r: any): any => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

let fx: Awaited<ReturnType<typeof createFixtureDb>>;
beforeAll(async () => {
	fx = await createFixtureDb();
});
afterAll(async () => {
	await fx.client.close();
});
let seq = 0;
const provenance = { source: 'seed' as const };
const ps = ['100001', '100002', '100003'].map((productId, i) =>
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
		// Every milk lists milk (GS1 AM) as Valio's records do; only 100001 claims lactose-free. Without AM a
		// declared record would be evidence of no milk at all (D16), and 100002 would rightly pass as lactose-free.
		allergens: { contains: ['AM'], mayContain: [], declared: true },
		freeFrom: i === 0 ? ['LACTOSE'] : [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: []
	})
);

async function setup() {
	const ws = `ws-adv10-${++seq}`;
	let price = 100;
	let available = 10000;
	const catalog: Catalog = {
		get: async (ids) =>
			new Map(ps.filter((p) => ids.includes(p.productId)).map((p) => [p.productId, p])),
		search: async () => ps,
		candidates: async () => [{ productId: '100002', fromValioRule: true }],
		offers: async (ids, date) => ({
			notFound: [],
			offers: ids.map((productId) =>
				Offer.parse({
					productId,
					price: { unitCents: price, comparison: null, taxRate: 14, validTo: null, provenance },
					availability: {
						kind: 'known',
						amount: productId === '100001' ? available : 10000,
						logisticModel: 'Stock',
						availableDate: date,
						closingTime: `${date}T17:00:00+02:00`,
						raw: null,
						provenance
					}
				})
			)
		})
	} as Catalog;
	const k = structuredClone(loadSeedKitchens().find((k) => k.id === 'k-hotel')!);
	k.usualProducts = ps.map((p) => p.productId);
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
	const b = await createDbPorts({
		db: fx.db as never,
		workspaceId: ws,
		catalog,
		kitchens: [k],
		now: '2026-12-07T09:00:00+02:00'
	});
	const h = createHandlers(b.ports);
	const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
		workspaceId: ws,
		runId: 'run-1',
		actor: { kind, id: `adv10-${kind}` },
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
	const place = async (): Promise<Plan> =>
		must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: k.id,
				deliverBy: '2026-12-10',
				idempotencyKey: 'place',
				lines: [{ productId: '100001', qty: 4, unit: 'ST', amount: { value: 4, unit: 'l' } }]
			})
		).plan;
	const task = async (plans: Plan[]) =>
		must(
			await tasks.put(
				{
					workspaceId: ws,
					runId: 'run-1',
					id: `task-adv10-${seq}`,
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
	/** A chef-reviewed one-dish menu (milk soup, 100 ml milk per guest, 40 guests) planned through plan_event. */
	const menu = async (dietary: string[] = []): Promise<Plan> => {
		const store = memoryMenuStore();
		(b.ports as any).menus = store;
		const p = MenuProposal.parse({
			id: `menu-${seq}`,
			revision: 0,
			kitchenId: k.id,
			status: 'proposed',
			brief: {
				title: 'Milk soup dinner',
				date: '2026-12-12',
				guests: 40,
				serviceStyle: 'plated',
				courses: 1,
				dietary,
				provenance
			},
			dishes: [
				{
					id: 'soup',
					name: 'Milk soup',
					course: 'soup',
					claimedCompatible: dietary,
					provenance,
					ingredients: [
						{
							id: 'milk',
							label: 'milk',
							productId: '100001',
							amountPerCover: 100,
							unit: 'ml',
							provenance
						}
					]
				}
			],
			open: [],
			provenance
		});
		await store.put(ws, p);
		must(
			await acceptMenu({ workspaceId: ws, store, catalog, now: () => b.ports.clock.now() } as any, {
				id: p.id,
				revision: 0,
				by: ctx('chef').actor
			})
		);
		return must(
			await h.plan_event(ctx('chef'), { kitchenId: k.id, proposal: { id: p.id, revision: 0 } })
		).plan;
	};
	const orders = async () => Object.values((await b.store.load(ws, 'run-1')).orders) as any[];
	return {
		b,
		h,
		ctx,
		tasks,
		deps,
		place,
		task,
		grant,
		menu,
		catalog,
		ws,
		orders,
		setPrice: (p: number) => {
			price = p;
		},
		setAvailable: (n: number) => {
			available = n;
		}
	};
}

describe('suite: adversarial (round 10)', () => {
	probe('R10-01', 'after a price change and a re-grant, Continue buys once', async () => {
		const s = await setup();
		const p = await s.place();
		const t = await s.task([p]);
		s.setPrice(200);
		await chatTurn({ taskId: t.id, continue: true }, s.deps); // TERMS_CHANGED: a new quote is saved
		await s.grant(p.id);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(await s.orders()).toHaveLength(1);
	});

	probe(
		'R10-02',
		'a cancel accepted while a Continue waits stops the purchase and stays cancelled',
		async () => {
			const s = await setup();
			const p = await s.place();
			const t = await s.task([p]);
			let entered!: () => void;
			const atRead = new Promise<void>((r) => {
				entered = r;
			});
			let release!: () => void;
			const hold = new Promise<void>((r) => {
				release = r;
			});
			let first = true;
			const h = {
				...s.h,
				get_plan: async (...args: Parameters<typeof s.h.get_plan>) => {
					if (first) {
						first = false;
						entered();
						await hold;
					}
					return s.h.get_plan(...args);
				}
			};
			const running = chatTurn({ taskId: t.id, continue: true }, { ...s.deps, handlers: h });
			await atRead;
			await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
			release();
			await running;
			expect(await s.orders()).toHaveLength(0);
			expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
		}
	);

	// The cancel fence must hold after it is checked: pause at the purchase itself (past any re-read of the task),
	// cancel, release. The commit must see the cancellation (under its own lock, or by refusing a cancelled task's
	// command), not buy on a stale read.
	probe(
		'R10-02b',
		'a cancel that lands after the fence check, before the purchase, still buys nothing',
		async () => {
			const s = await setup();
			const p = await s.place();
			const t = await s.task([p]);
			let entered!: () => void;
			const atCommit = new Promise<void>((r) => {
				entered = r;
			});
			let release!: () => void;
			const hold = new Promise<void>((r) => {
				release = r;
			});
			const h = {
				...s.h,
				commit_order: async (...args: Parameters<typeof s.h.commit_order>) => {
					entered();
					await hold;
					return s.h.commit_order(...args);
				}
			};
			const running = chatTurn({ taskId: t.id, continue: true }, { ...s.deps, handlers: h });
			await Promise.race([atCommit, running]);
			await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
			release();
			await running;
			expect(await s.orders()).toHaveLength(0);
			expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
		}
	);

	probe(
		'R10-03',
		'a reviewed lactose-free menu keeps its requirement: ordinary milk is never bought',
		async () => {
			const s = await setup();
			const p = await s.menu(['lactose-free']);
			const sub = await s.h.find_substitutes(s.ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			});
			await s.grant(p.id);
			const got = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
			await s.h.commit_order(s.ctx('kitchen_agent'), {
				planId: p.id,
				version: got.version,
				idempotencyKey: 'buy'
			});
			const bought = (await s.orders()).flatMap((o) => o.lines.map((l: any) => l.productId));
			expect(bought, `substitute ${sub.ok ? 'applied' : sub.error.code}`).not.toContain('100002');
			expect(p.needs[0].requirements?.freeFrom ?? []).toContain('LACTOSE');
		}
	);

	probe('R10-04', 'a menu amount edit after a substitution buys the new amount once', async () => {
		const s = await setup();
		const p = await s.menu();
		const sub = must(
			await s.h.find_substitutes(s.ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			})
		);
		const edit = must(
			await s.h.edit_line(s.ctx('chef'), {
				planId: p.id,
				version: sub.plan.version,
				needId: p.needs[0].id,
				patch: { gramsPerGuest: 200 }
			})
		).plan;
		expect(edit.needs[0].amount.value).toBe(8);
		await s.grant(p.id);
		const got = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
		must(
			await s.h.commit_order(s.ctx('kitchen_agent'), {
				planId: p.id,
				version: got.version,
				idempotencyKey: 'buy'
			})
		);
		const litres = (await s.orders())
			.flatMap((o) => o.lines)
			.reduce((n: number, l: any) => n + l.qty.value, 0);
		expect(litres).toBe(8);
	});

	probe(
		'R10-05',
		'contention on a 4 l need with 2 l left adds only the 2 l remainder',
		async () => {
			const s = await setup();
			const p = await s.place();
			s.setAvailable(2);
			must(
				await rescueContention(s.b.ports, s.ctx('kitchen_agent'), {
					productId: '100001',
					note: 'two units left'
				})
			);
			const got = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
			const planned = got.lines
				.filter((l: any) => l.qty.value > 0)
				.reduce((n: number, l: any) => n + l.qty.value, 0);
			expect(planned).toBe(4);
			expect(got.view!.fulfilment[0].excess.value).toBe(0);
		}
	);

	probe(
		'R10-06',
		'a recipe with one ingredient partly confirmed is not fully supplier confirmed',
		() => {
			const need: any = {
				id: 'n',
				label: 'soup',
				kind: 'dish',
				amount: { value: 10, unit: 'kg' },
				provenance
			};
			const lines: any[] = ['a', 'b'].map((id) => ({
				id,
				needId: 'n',
				productId: id,
				qty: { value: 10, unit: 'KG' },
				state: 'committed',
				strategy: { id: 'recipe', kind: 'make_in_house' }
			}));
			const f = fulfilmentOf(need, lines, new Map(), {
				pack: () => ({ value: 1, unit: 'kg' }),
				recipeUnit: () => 1,
				receipt: () => 'confirmed',
				confirmedQty: (id: string) => (id === 'a' ? 1 : 10)
			} as any);
			expect(f.supplierConfirmed.value).toBeLessThanOrEqual(1);
		}
	);

	probe(
		'R10-07',
		'a dish whose ingredients change is compared again, not served the old comparison',
		async () => {
			resetGrounding();
			const d = {
				exa: createFixtureFactSearch(),
				catalog: (await setup()).catalog,
				findings: createFindings(undefined, true)
			};
			await startGrounding(
				[
					{
						name: 'joulutorttu',
						ingredients: [
							{ label: 'lehtitaikinalevyt' },
							{ label: 'kananmuna' },
							{ label: 'kuohukerma' },
							{ label: 'kaviaari' }
						]
					}
				],
				d as any
			);
			await startGrounding(
				[{ name: 'joulutorttu', ingredients: [{ label: 'porkkana' }] }],
				d as any
			);
			const revised: any = groundingFor([
				{ name: 'joulutorttu', ingredients: [{ label: 'porkkana' }] }
			]).joulutorttu;
			expect(revised?.modelOnly ?? []).toContain('porkkana');
			expect(revised?.modelOnly ?? []).not.toContain('kaviaari');
		}
	);

	probe('R10-08', 'a Thursday-only receiving series starts on a Thursday', () => {
		const ics = buildCalendar({
			kitchen: { id: 'k-hotel', name: 'Hotel', deliveryDays: ['thu'] },
			decisions: [],
			deliveries: [],
			window: { from: '2026-11-07', to: '2027-05-01' },
			stamp: '2026-11-14T12:00:00Z'
		} as any);
		const m = ics.match(/DTSTART;VALUE=DATE:(\d{8})\r\n[^]*?RRULE:FREQ=WEEKLY;BYDAY=TH/);
		expect(m, 'a weekly Thursday receiving series').toBeTruthy();
		const d = m![1];
		const day = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T12:00:00Z`).getUTCDay();
		expect(day, `DTSTART ${d}`).toBe(4);
	});

	probe(
		'R10-10',
		'the agent loop gives two different line subsets two commands, and both buy',
		async () => {
			const s = await setup();
			const p = must(
				await s.h.place_order(s.ctx('kitchen_agent'), {
					kitchenId: 'k-hotel',
					deliverBy: '2026-12-10',
					idempotencyKey: 'two',
					lines: ['100001', '100002'].map((productId) => ({
						productId,
						qty: 4,
						unit: 'ST',
						amount: { value: 4, unit: 'l' as const }
					}))
				})
			).plan;
			const command = async (lineId: string) =>
				(await withServerKey(
					'commit_order',
					{ planId: p.id, version: p.version, lineIds: [lineId] },
					undefined,
					'continue',
					'same-task'
				)) as any;
			const a = await command(p.lines[0].id);
			const b = await command(p.lines[1].id);
			expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
			must(await s.h.commit_order(s.ctx('kitchen_agent'), a));
			must(await s.h.commit_order(s.ctx('kitchen_agent'), b));
		}
	);

	probe(
		'R10-15',
		'a question about a named product answers for that product, or asks which',
		async () => {
			const s = await setup();
			const products = [
				Product.parse({
					...ps[0],
					nameFi: 'Valio kevytmaito 1 l',
					nameEn: 'Valio semi-skimmed milk',
					category: '10400',
					origin: 'fi'
				}),
				Product.parse({
					...ps[1],
					nameFi: 'Arla täysmaito 1 l',
					nameEn: 'Arla whole milk',
					category: '10400',
					origin: 'se'
				})
			];
			const h = { ...s.h, search_products: async () => ok({ products }) };
			const answer = await answerQuestion(
				{ kind: 'product', aspect: 'origin', query: 'Arla whole milk' } as any,
				s.ctx('kitchen_agent'),
				h as any
			);
			expect(answer.text).not.toContain('Valio semi-skimmed milk');
			// The Arla's own origin, or a question that names the choice: never just any "?".
			expect(answer.text, answer.text).toMatch(/Sweden|Which .*\?/);
		}
	);

	probe(
		'R10-16',
		'the agent card advertises exactly the tools the outside agent is offered',
		async () => {
			const s = await setup();
			const was = process.env.VISION_LIVE;
			delete process.env.VISION_LIVE;
			try {
				const listed = toolsFor(s.ctx('external_agent'));
				const r = await agentCard({
					url: new URL('http://localhost/.well-known/agent.json')
				} as never);
				const skills = ((await r.json()) as { skills: { id: string }[] }).skills.map((x) => x.id);
				for (const id of skills.filter((x) => /^[a-z_]+$/.test(x)))
					expect(listed, `card advertises ${id}`).toContain(id);
			} finally {
				if (was !== undefined) process.env.VISION_LIVE = was;
			}
		}
	);
});
