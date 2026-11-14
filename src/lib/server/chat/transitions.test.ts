/**
 * Chat/task transition guarantees, each the flipped form of a round-9 adversarial probe (docs/review/ROUND9-ADVERSARIAL.md):
 * purchase commands per authorised line set (R9-01, R9-05), cancellation as a fence (R9-02), every plan of a task in
 * its state and its Continue (R9-04), separate requests stay separate and a task is never lost after its effects (R8).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Offer, Product, SCOPES_BY_ACTOR, type Plan } from '$lib/core/contracts';
import type { Task } from '$lib/core/contracts/task';
import type { CallContext, Catalog, TaskStore } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createFixtureDb } from '$lib/server/db/pglite';
import { createDbPorts, loadSeedKitchens } from '$lib/server/store/db-ports';
import { readTask } from '$lib/server/tasks/outcome';
import { project } from '$lib/server/tasks/project';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { withServerKey } from '../agent/loop';
import { readTurnBody } from './body';
import { chatTurn } from './turn';

let fx: Awaited<ReturnType<typeof createFixtureDb>>;
beforeAll(async () => {
	fx = await createFixtureDb();
});
afterAll(async () => {
	await fx.client.close();
});

let seq = 0;
/** The supplier's price per unit in cents, changed by a test to move the terms. */
let price = 100;
const prov = { source: 'seed' as const };
const products = ['100001', '100002', '100003'].map((productId, i) =>
	Product.parse({
		productId,
		nameFi: `Test milk ${i} 1 l`,
		nameEn: `milk ${i} 1 l`,
		category: '10000',
		categoryGroup: '10',
		isFood: true,
		vendor: 'Test',
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
// Cream with both a weight and a volume per pack: Valio's own density converts kg to l, after a confirmation.
products.push(
	Product.parse({
		...products[0],
		productId: '100004',
		nameFi: 'Test cream 1 l',
		nameEn: 'cream 1 l',
		netPerSalesUnit: { value: { value: 1.031, unit: 'kg' }, provenance: prov },
		netVolumePerSalesUnit: { value: { value: 1, unit: 'l' }, provenance: prov }
	})
);
const catalog: Catalog = {
	get: async (ids) =>
		new Map(products.filter((p) => ids.includes(p.productId)).map((p) => [p.productId, p])),
	search: async () => products,
	candidates: async () => [],
	offers: async (ids, date) => ({
		notFound: [],
		offers: ids.map((productId) =>
			Offer.parse({
				productId,
				price: { unitCents: price, comparison: null, taxRate: 14, validTo: null, provenance: prov },
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
};

function must<T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
}

/** A kitchen where 100001 is a usual product (eligible) and anything new is held for the chef. */
async function setup(tasks: TaskStore = memoryTaskStore()) {
	price = 100;
	const ws = `ws-transitions-${++seq}`;
	const k = structuredClone(loadSeedKitchens().find((x) => x.id === 'k-hotel')!);
	k.usualProducts = ['100001'];
	k.constraints = {
		origin: [],
		allergens: { freeFrom: [], unknownCounts: 'hold' },
		tenderListOnly: false,
		labels: []
	};
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
		catalog,
		kitchens: [k],
		now: '2026-12-07T09:00:00+02:00'
	});
	const h = createHandlers(b.ports);
	const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
		workspaceId: ws,
		runId: 'run-1',
		actor: { kind, id: `t-${kind}` },
		scopes: SCOPES_BY_ACTOR[kind],
		via: 'test'
	});
	const deps = {
		handlers: h,
		ctx: ctx('chef'),
		ports: { ...b.ports, tasks },
		workspaceId: ws,
		kitchen: { id: k.id },
		today: '2026-12-07'
	};
	const place = async (ids: string[], key = 'place') =>
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
					id: `task-transitions-${seq}`,
					kitchenId: k.id,
					title: 'milk',
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
				},
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
	return { b, h, ctx, tasks, deps, place, task, grant, state, ws };
}

describe('suite: chat transitions (round 9)', () => {
	it('R9-01: a grant after a partial commit is a new purchase; retries replay their own receipt', async () => {
		const s = await setup();
		const p = await s.place(['100001', '100002']);
		const t = await s.task([p]);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(Object.values((await s.state()).orders)).toHaveLength(1);
		await s.grant(p.id);
		const second = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(second.some((e) => e.type === 'step' && e.tool === 'commit_order' && e.ok)).toBe(true);
		let st = await s.state();
		expect(Object.values(st.orders)).toHaveLength(2);
		expect(st.plans[p.id].lines.map((l) => l.state)).toEqual(['committed', 'committed']);
		// Each line in exactly one purchase.
		const bought = Object.values(st.orders).flatMap((o) => o.lines.map((l) => l.lineId));
		expect(new Set(bought).size).toBe(bought.length);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		st = await s.state();
		expect(Object.values(st.orders)).toHaveLength(2);
	});

	it('R9-02: a cancelled task orders nothing, even through a stale Continue after a grant', async () => {
		const s = await setup();
		const p = await s.place(['100002']);
		const t = await s.task([p]);
		await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
		await s.grant(p.id);
		const out = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(Object.values((await s.state()).orders)).toHaveLength(0);
		expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
		expect(out.at(-1)).toMatchObject({ type: 'done', text: expect.stringMatching(/cancelled/) });
		const resize = await chatTurn({ taskId: t.id, text: 'make it 6 l' }, s.deps);
		expect(resize.some((e) => e.type === 'step' && e.tool === 'edit_line')).toBe(false);
	});

	it('R9-04: a task is not done while another plan waits; Continue buys every authorised plan', async () => {
		const s = await setup();
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
		const projected = project(t as Task, read);
		expect(projected.task.state).not.toBe('done');
		expect(projected.task.pending.kind).toBe('decision');
		expect(projected.task.ledger!.nextAction).not.toMatch(/supplier confirmed/);
		await s.grant(p2.id);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect((await s.state()).plans[p2.id].lines[0].state).toBe('committed');
	});

	it('R9-05: one granted reason group is bought while another stays held', async () => {
		const s = await setup();
		const p = await s.place(['100002', '100003']);
		const t = await s.task([p]);
		await s.grant(p.id, [p.lines[0].id]);
		const out = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(out.some((e) => e.type === 'step' && e.tool === 'commit_order' && e.ok)).toBe(true);
		const st = await s.state();
		expect(Object.values(st.orders)).toHaveLength(1);
		expect(st.plans[p.id].lines.map((l) => l.state)).toEqual(['committed', 'held']);
	});

	it('R9-03: kilograms for a line bought in litres are asked about, never applied', async () => {
		const s = await setup();
		const p = await s.place(['100002']);
		const t = await s.task([p]);
		const out = await chatTurn({ taskId: t.id, text: 'make it 20 kg' }, s.deps);
		expect(out.some((e) => e.type === 'step' && e.tool === 'edit_line' && e.ok)).toBe(false);
		expect(out.at(-1)).toMatchObject({
			type: 'done',
			text: expect.stringMatching(/That need is in litres: how many litres\?/)
		});
		// The question is the task's open clarify; the answer in the need's unit resizes need and line together.
		expect((await s.tasks.get(s.ws, t.id))!.pending).toMatchObject({
			kind: 'clarify',
			field: 'qty'
		});
		const ok = await chatTurn({ taskId: t.id, text: '6' }, s.deps);
		expect(ok.some((e) => e.type === 'step' && e.tool === 'edit_line' && e.ok)).toBe(true);
		const plan = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
		// The need and the purchase move together.
		expect(plan.lines[0].qty.value).toBe(6);
		expect(plan.needs[0].amount).toMatchObject({ value: 6, unit: 'l' });
	});

	it('R9-03: kilograms for a litre need with a known density are confirmed, then applied', async () => {
		const s = await setup();
		const p = await s.place(['100004']);
		const t = await s.task([p]);
		const q = await chatTurn({ taskId: t.id, text: 'make it 20 kg' }, s.deps);
		const ask = q.find((e) => e.type === 'clarify');
		if (ask?.type !== 'clarify') throw new Error('no question');
		expect(ask.question).toMatch(/That's about 19\.4\d* l by Valio's own pack data/);
		const use = ask.options[0];
		await chatTurn({ taskId: t.id, answer: { field: 'qty', value: use.value } }, s.deps);
		const plan = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
		expect(plan.needs[0].amount.unit).toBe('l');
		expect(plan.needs[0].amount.value).toBeCloseTo(19.4, 1);
	});

	it('R8: a task survives a failed save after its effects; the effect is reconciled onto it', async () => {
		const inner = memoryTaskStore();
		let puts = 0;
		// Another window writes the task between this turn's reservation and its final save.
		const racing: TaskStore = {
			get: (ws, id) => inner.get(ws, id),
			list: (ws, o) => inner.list(ws, o),
			async put(task, expected) {
				if (++puts === 3) {
					const now = await inner.get(task.workspaceId, task.id);
					if (now) await inner.put({ ...now, title: 'renamed elsewhere' }, now.version);
				}
				return inner.put(task, expected);
			}
		};
		const s = await setup(racing);
		const p = await s.place(['100001']);
		const t = await s.task([p]);
		const out = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(Object.values((await s.state()).orders)).toHaveLength(1);
		expect(out.at(-1)).toMatchObject({ type: 'done', state: expect.not.stringMatching(/failed/) });
		const saved = await inner.get(s.ws, t.id);
		expect(saved?.plans.map((x) => x.planId)).toEqual([p.id]);
		expect(saved?.state).not.toBe('running');
	});
});

describe('suite: chat transitions · separate requests', () => {
	it('R8: two new tasks with the same words are two orders', { timeout: 120_000 }, async () => {
		const w = await trialWorkspace();
		w.env.ports.clock = { now: () => FIDELITY_NOW };
		const deps = {
			handlers: w.handlers,
			ctx: w.ctx('chef'),
			ports: w.env.ports,
			workspaceId: w.env.workspaceId,
			kitchen: { id: 'k-hotel' },
			today: scenarioDate(FIDELITY_NOW)
		};
		const a = await chatTurn({ text: 'Order 4 kg butter for Friday' }, deps);
		const b = await chatTurn({ text: 'Order 4 kg butter for Friday' }, deps);
		expect(a.at(-1)!.taskId).not.toBe(b.at(-1)!.taskId);
		expect(Object.keys((await w.state()).plans)).toHaveLength(2);
	});
});

describe('suite: chat transitions (round 10)', () => {
	it('R10-01: after a terms change, Continue orders once on the new terms; a retry replays that receipt', async () => {
		const s = await setup();
		const p = await s.place(['100001']);
		const t = await s.task([p]);
		price = 200;
		const first = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(first.some((e) => e.type === 'step' && e.tool === 'commit_order' && !e.ok)).toBe(true);
		expect(first.at(-1)).toMatchObject({ text: expect.stringMatching(/terms changed/) });
		expect(Object.values((await s.state()).orders)).toHaveLength(0);
		const view = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id }));
		if (view.approval?.state === 'pending') await s.grant(p.id);
		const second = await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(second.some((e) => e.type === 'step' && e.tool === 'commit_order' && e.ok)).toBe(true);
		expect(Object.values((await s.state()).orders)).toHaveLength(1);
		await chatTurn({ taskId: t.id, continue: true }, s.deps);
		expect(Object.values((await s.state()).orders)).toHaveLength(1);
	});

	it('R10-02: a cancellation accepted while a Continue waits stops its purchase and stands', async () => {
		const s = await setup();
		const p = await s.place(['100001']);
		const t = await s.task([p]);
		let entered!: () => void;
		const atRead = new Promise<void>((r) => (entered = r));
		let release!: () => void;
		const hold = new Promise<void>((r) => (release = r));
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
		const cancel = await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
		expect(cancel.at(-1)).toMatchObject({ state: 'cancelled' });
		release();
		const out = await running;
		expect(Object.values((await s.state()).orders)).toHaveLength(0);
		expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
		expect(out.at(-1)).toMatchObject({ text: expect.stringMatching(/cancelled/) });
	});

	it('R10-02b: a cancel that lands after the fence check, inside the purchase, still buys nothing', async () => {
		const s = await setup();
		const p = await s.place(['100001']);
		const t = await s.task([p]);
		let entered!: () => void;
		const atCommit = new Promise<void>((r) => (entered = r));
		let release!: () => void;
		const hold = new Promise<void>((r) => (release = r));
		const h = {
			...s.h,
			commit_order: async (...args: Parameters<typeof s.h.commit_order>) => {
				entered();
				await hold;
				return s.h.commit_order(...args);
			}
		};
		const running = chatTurn({ taskId: t.id, continue: true }, { ...s.deps, handlers: h });
		await atCommit;
		await chatTurn({ taskId: t.id, text: 'cancel that' }, s.deps);
		release();
		const out = await running;
		expect(Object.values((await s.state()).orders)).toHaveLength(0);
		expect((await s.tasks.get(s.ws, t.id))!.state).toBe('cancelled');
		expect(out.at(-1)).toMatchObject({ text: expect.stringMatching(/cancelled/) });
	});

	it('the plan on screen scopes the dock: "where do we stand?" answers for it, in words', async () => {
		const s = await setup();
		const p1 = await s.place(['100001'], 'one');
		await s.place(['100002'], 'two');
		// A remembered task with nothing of its own (no plan, no question) and the page's plan beside it.
		const stale = await s.task([]);
		const out = await chatTurn(
			{ taskId: stale.id, planId: p1.id, text: 'where do we stand?' },
			s.deps
		);
		// What the chef reads: the closing words, the step lines and any question.
		const said = out
			.map((e) =>
				e.type === 'done'
					? e.text
					: e.type === 'step'
						? e.summary
						: e.type === 'clarify'
							? `${e.question} ${e.options.map((o) => o.label).join(' ')}`
							: ''
			)
			.join(' ');
		expect(out.some((e) => e.type === 'clarify' && e.field === 'plan')).toBe(false);
		expect(said).not.toMatch(/pl-run-|Nothing is planned/);
		const done = out.at(-1);
		expect(done?.type === 'done' && done.text.length > 0).toBe(true);
		expect(out.find((e) => e.taskId)?.taskId).not.toBe(stale.id);
	});

	it('a reply to an open question: an offered answer is that answer; anything else asks again, with context', async () => {
		const s = await setup();
		const first = await chatTurn({ text: '10000 bolognese pasta' }, s.deps);
		const taskId = first.find((e) => e.taskId)!.taskId;
		expect(first.find((e) => e.type === 'clarify')).toMatchObject({ field: 'dish' });
		const unclear = await chatTurn({ taskId, text: 'hmm?' }, s.deps);
		const again = unclear.find((e) => e.type === 'clarify');
		expect(again).toMatchObject({ field: 'dish' });
		expect(again?.type === 'clarify' && again.question).toMatch(/bolognese/);
		const yes = await chatTurn({ taskId, text: 'yes please' }, s.deps);
		expect(yes.find((e) => e.type === 'clarify')?.field).not.toBe('dish');
		expect((await s.tasks.get(s.ws, taskId))?.requirement.kind).toBe('event');
	});

	it('a plan picked by the chef is asked in words, never by id', async () => {
		const s = await setup();
		await s.place(['100001'], 'one');
		await s.place(['100002'], 'two');
		const out = await chatTurn({ text: 'show me the plan status' }, s.deps);
		const ask = out.find((e) => e.type === 'clarify');
		if (ask?.type === 'clarify') {
			expect(ask.question).not.toMatch(/pl-|k-hotel/);
			for (const o of ask.options) expect(o.label).not.toMatch(/pl-|\d{4}-\d{2}-\d{2}/);
		}
		expect(JSON.stringify(out.filter((e) => e.type === 'done'))).not.toMatch(/pl-run-/);
	});

	it('R10-10: the agent loop gives different line subsets of one version different commands', async () => {
		const s = await setup();
		const p = await s.place(['100001', '100003']);
		await s.grant(p.id);
		const command = async (lineId: string) =>
			(await withServerKey(
				'commit_order',
				{ planId: p.id, version: p.version, lineIds: [lineId] },
				undefined,
				'continue',
				'same-task'
			)) as { planId: string; version: number; lineIds: string[]; idempotencyKey: string };
		const a = await command(p.lines[0].id);
		const b = await command(p.lines[1].id);
		expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
		must(await s.h.commit_order(s.ctx('kitchen_agent'), a));
		const now = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
		const next = await s.h.commit_order(s.ctx('kitchen_agent'), { ...b, version: now.version });
		expect(next.ok).toBe(true);
	});

	it('R10-12: the chat envelope refuses null, a bad task id and two actions at once', () => {
		expect(readTurnBody(null)).toMatchObject({ ok: false });
		expect(readTurnBody([])).toMatchObject({ ok: false });
		expect(readTurnBody({ taskId: '../x', text: 'hi' })).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/taskId/)
		});
		expect(readTurnBody({ text: 'hi', continue: true })).toMatchObject({ ok: false });
		expect(readTurnBody({ taskId: 't-pl-run-1-abc', text: 'hi' })).toMatchObject({ ok: true });
	});
});
