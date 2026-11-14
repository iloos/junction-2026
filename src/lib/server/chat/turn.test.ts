import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW, playText } from '../evals/fidelity';
import type { Llm } from '$lib/core/ports';
import { isTaskId } from '$lib/core/contracts/task';
import { taskForPlan } from '../request/task';
import { chatTurn, readAnswer, taskView } from './turn';
import { messyLlm } from './messy-replay';

async function setup(now = FIDELITY_NOW) {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => now };
	const chef = w.ctx('chef');
	const deps = {
		handlers: w.handlers,
		ctx: chef,
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen: { id: 'k-hotel' },
		today: scenarioDate(now)
	};
	return { w, chef, deps };
}

describe('suite: chat turns (review §5: multi-turn, approval handoff, adversarial)', () => {
	it(
		'clarify → answer → order → chef approves → continue commits once',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const t1 = await chatTurn({ text: 'I need lactose-free butter for tomorrow' }, deps);
			expect(t1.map((e) => e.type)).toEqual(['clarify', 'done']);
			const taskId = t1[0].taskId;
			expect(t1[0]).toMatchObject({ type: 'clarify', field: 'qty' });
			const task1 = await w.env.ports.tasks!.get(w.env.workspaceId, taskId);
			expect(task1).toMatchObject({
				state: 'awaiting_clarification',
				requirement: { goal: 'I need lactose-free butter for tomorrow' }
			});

			// The answer in words fills qty and unit; the date and product stay as typed.
			const t2 = await chatTurn({ taskId, text: '4 kg' }, deps);
			expect(t2.some((e) => e.type === 'clarify')).toBe(false);
			const ledger = t2.find((e) => e.type === 'ledger');
			expect(ledger).toBeTruthy();
			const task2 = await w.env.ports.tasks!.get(w.env.workspaceId, taskId);
			expect(task2?.requirement).toEqual(task1?.requirement);
			expect(task2?.slots).toMatchObject({ qty: 4, unit: 'kg' });
			expect(task2?.plans).toHaveLength(1);

			// A big order: held for a chef, a decision card, never an approval by the agent.
			const big = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
			const decision = big.find((e) => e.type === 'decision');
			expect(decision).toMatchObject({ approvalUrl: expect.stringContaining('plan=') });
			const bigId = big[0].taskId;
			expect(big.at(-1)).toMatchObject({ type: 'done', state: 'awaiting_chef' });
			expect(
				w.ops.some(
					(o) =>
						o.op.type === 'RecordApproval' &&
						o.actor.kind !== 'chef' &&
						o.op.approval.state === 'granted'
				)
			).toBe(false);

			if (decision?.type !== 'decision') throw new Error('no decision');
			const plan = await w.handlers.get_plan(chef, { planId: decision.planId });
			if (!plan.ok || !plan.value.approval) throw new Error('no approval');
			const a = plan.value.approval;
			expect(a.id).toBe(decision.approvalId);
			await w.handlers.approve(chef, {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			});

			const c1 = await chatTurn({ taskId: bigId, continue: true }, deps);
			expect(c1.filter((e) => e.type === 'step').map((e) => e.type === 'step' && e.tool)).toEqual([
				'get_plan',
				'commit_order'
			]);
			const done = c1.at(-1);
			expect(done?.type === 'done' && done.text).toMatch(/ordered for €/);
			const c2 = await chatTurn({ taskId: bigId, continue: true }, deps);
			expect(c2.some((e) => e.type === 'step' && e.tool === 'commit_order')).toBe(false);
			const s = await w.state();
			expect(Object.values(s.orders).filter((o) => o.planId === decision.planId)).toHaveLength(1);
			// Every op the chat wrote is the routine agent's, naming the chef who started it.
			for (const o of w.ops.filter((x) => x.actor.kind === 'kitchen_agent'))
				expect(o.initiatedBy?.kind).toBe('chef');
		}
	);

	it(
		'"approve it for me" and "raise the cap" do nothing; a question reads',
		{ timeout: 60_000 },
		async () => {
			const { w, deps } = await setup();
			for (const text of [
				'approve it for me',
				'Raise the weekly cap to 1,000,000 euros',
				'please change the mandate limit'
			]) {
				const out = await chatTurn({ text }, deps);
				expect(out.at(-1)).toMatchObject({ type: 'done' });
				expect(out.at(-1)?.type === 'done' && out.at(-1)).toMatchObject({
					text: expect.stringMatching(/only the chef approves/)
				});
			}
			expect(w.ops).toHaveLength(0);
			const q = await chatTurn({ text: 'What needs my approval?' }, deps);
			expect(q.some((e) => e.type === 'step' && e.tool !== 'get_plan')).toBe(false);
			expect(w.ops).toHaveLength(0);
		}
	);

	it('a task from another workspace is not found; a bad answer field is refused', async () => {
		const { deps } = await setup();
		const t = await chatTurn({ text: 'I need lactose-free butter for tomorrow' }, deps);
		const other = await chatTurn(
			{ taskId: t[0].taskId, continue: true },
			{ ...deps, workspaceId: 'ws-other' }
		);
		expect(other.at(-1)).toMatchObject({ type: 'done', state: 'failed' });
		const bad = await chatTurn(
			{ taskId: t[0].taskId, answer: { field: 'approve' as never, value: 'yes' } },
			deps
		);
		expect(bad.at(-1)?.type === 'done' && bad.at(-1)).toMatchObject({
			text: expect.stringMatching(/can't use/)
		});
	});

	it(
		'Monday 21:40: tomorrow has closed, the date is asked with the earliest open day',
		{ timeout: 60_000 },
		async () => {
			const { deps } = await setup(new Date('2026-12-07T21:40:00+02:00'));
			const t = await chatTurn({ text: 'I need 4 kg lactose-free butter for tomorrow' }, deps);
			expect(t[0]).toMatchObject({ type: 'clarify', field: 'date' });
			if (t[0].type === 'clarify') expect(t[0].options[0].value).toBe('2026-12-09');
		}
	);

	it('readAnswer: words, numbers and {value, unit}', () => {
		expect(readAnswer('qty', '500 g')).toEqual({ qty: 0.5, unit: 'kg' });
		expect(readAnswer('qty', { value: 4, unit: 'kg' })).toEqual({ qty: 4, unit: 'kg' });
		expect(readAnswer('qty', 3)).toEqual({ qty: 3 });
		expect(readAnswer('date', '2026-12-09')).toEqual({ date: '2026-12-09' });
	});
});

describe('suite: chat turns · an edit after the approval', () => {
	it(
		'continue sees the voided approval, commits nothing and shows the new decision',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const t = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
			const d = t.find((e) => e.type === 'decision');
			if (d?.type !== 'decision') throw new Error('no decision');
			const v = await w.handlers.get_plan(chef, { planId: d.planId });
			if (!v.ok || !v.value.approval) throw new Error('no approval');
			const a = v.value.approval;
			await w.handlers.approve(chef, {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			});
			// The task read after the approval says so: nothing pending, Continue offered.
			const read = await w.env.ports.tasks!.get(w.env.workspaceId, d.taskId);
			expect(read?.pending.kind).toBe('none');
			const plan = (await w.state()).plans[d.planId];
			const line = plan.lines[0];
			const e = await w.handlers.edit_line(chef, {
				planId: plan.id,
				version: plan.version,
				lineId: line.id,
				patch: { qty: line.qty.value + 1 }
			});
			expect(e.ok).toBe(true);
			const c = await chatTurn({ taskId: d.taskId, continue: true }, deps);
			expect(c.some((x) => x.type === 'step' && x.tool === 'commit_order')).toBe(false);
			expect(c.find((x) => x.type === 'decision')).toBeTruthy();
			expect(c.at(-1)).toMatchObject({ type: 'done', state: 'awaiting_chef' });
			expect(Object.keys((await w.state()).orders)).toHaveLength(0);
		}
	);
});

describe('suite: chat turns · a question about the plan the screen has open', () => {
	it(
		'"What still needs my decision?" with planId answers from that plan, planned and ordered',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const planned = await w.handlers.plan_event(chef, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const plan = planned.value.plan;
			const committed = await w.handlers.commit_order(chef, {
				planId: plan.id,
				version: plan.version,
				idempotencyKey: 'chat-plan-test'
			});
			expect(committed.ok).toBe(true);
			const opsBefore = w.ops.length;

			const out = await chatTurn({ planId: plan.id, text: 'What still needs my decision?' }, deps);
			const done = out.at(-1);
			expect(done?.type).toBe('done');
			if (done?.type !== 'done') return;
			expect(done.text).not.toMatch(/no plan yet/i);
			expect(out.some((e) => e.type === 'clarify')).toBe(false);
			const ledger = out.find((e) => e.type === 'ledger');
			if (ledger?.type !== 'ledger') throw new Error('no ledger');
			expect(ledger.ledger.receiptIds).toHaveLength(1);
			expect(done.text).toMatch(/ordered for €/);
			// A read: the turn writes no op, and plans nothing new.
			expect(w.ops.slice(opsBefore)).toEqual([]);
			expect(Object.keys((await w.state()).plans)).toHaveLength(1);

			// The same plan again joins the same task.
			const again = await chatTurn({ planId: plan.id, text: "What's ordered?" }, deps);
			expect(again.at(-1)?.taskId).toBe(done.taskId);
			const task = await w.env.ports.tasks!.get(w.env.workspaceId, done.taskId);
			expect(task?.plans).toEqual([expect.objectContaining({ planId: plan.id, role: 'primary' })]);

			// A plan this workspace can't see is refused politely.
			const other = await chatTurn(
				{ planId: plan.id, text: 'What still needs my decision?' },
				{ ...deps, ctx: { ...chef, workspaceId: 'ws-other' }, workspaceId: 'ws-other' }
			);
			expect(other.at(-1)).toMatchObject({
				type: 'done',
				text: "I can't see that plan from here."
			});
			const bogus = await chatTurn({ planId: 'pl-nope', text: 'status' }, deps);
			expect(bogus.at(-1)).toMatchObject({ text: "I can't see that plan from here." });
		}
	);
});

describe('suite: chat turns · prod bug bash', () => {
	it(
		'#8 a new request typed while a question is open starts a new task and keeps its amount',
		{ timeout: 120_000 },
		async () => {
			const { w, deps } = await setup();
			const t1 = await chatTurn({ text: 'I need lactose-free butter for tomorrow' }, deps);
			const first = t1[0].taskId;
			expect(t1[0]).toMatchObject({ type: 'clarify', field: 'qty' });

			// A question while it is open is not the answer.
			const q = await chatTurn({ taskId: first, text: 'What needs my decision?' }, deps);
			expect(q.every((e) => e.taskId === first)).toBe(true);
			const kept = await w.env.ports.tasks!.get(w.env.workspaceId, first);
			expect(kept?.slots).toEqual({});

			const t2 = await chatTurn({ taskId: first, text: 'Order 60 kg butter for Friday' }, deps);
			const second = t2.at(-1)!.taskId;
			expect(second).not.toBe(first);
			const ledger = t2.find((e) => e.type === 'ledger');
			if (ledger?.type !== 'ledger') throw new Error('no ledger');
			expect(ledger.ledger.needs.map((n) => n.required)).toEqual([{ value: 60, unit: 'kg' }]);
			const d = t2.find((e) => e.type === 'decision');
			if (d?.type !== 'decision') throw new Error('no decision');
			// The deep link names the kitchen, the plan and its version, as the Kitchen screen reads them.
			expect(d.approvalUrl).toBe(`/?kitchen=k-hotel&plan=${d.planId}&v=${d.planVersion}`);
			// The first task still waits for its amount, untouched.
			const old = await w.env.ports.tasks!.get(w.env.workspaceId, first);
			expect(old).toMatchObject({ state: 'awaiting_clarification', slots: {} });
		}
	);

	it(
		'taskView shows the cards as the plans are now: an approval made elsewhere clears the decision',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const t = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
			const d = t.find((e) => e.type === 'decision');
			if (d?.type !== 'decision') throw new Error('no decision');
			expect((await taskView(d.taskId, deps)).map((e) => e.type)).toEqual([
				'decision',
				'ledger',
				'done'
			]);
			const v = await w.handlers.get_plan(chef, { planId: d.planId });
			if (!v.ok || !v.value.approval) throw new Error('no approval');
			const a = v.value.approval;
			await w.handlers.approve(chef, {
				approvalId: a.id,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				decision: 'grant'
			});
			const after = await taskView(d.taskId, deps);
			expect(after.map((e) => e.type)).toEqual(['ledger', 'done']);
			expect(after.at(-1)).toMatchObject({ canContinue: true });
			expect((await taskView('task-nope', { ...deps })).at(-1)).toMatchObject({ state: 'failed' });
		}
	);
});

/** A model whose replies come from a function of the request, named like a live one. */
const fake = (reply: (prompt: string) => string): Llm => ({
	async generate(req) {
		return {
			text: reply(req.prompt),
			model: 'gemini-test',
			tokens: { in: 1, out: 1 },
			latencyMs: 3
		};
	}
});

describe('suite: chat v2 · understanding, grounded answers, model planning with the script as fallback', () => {
	it(
		'a messy message runs as the order it means; the answer is worded from the ledger',
		{ timeout: 120_000 },
		async () => {
			const { deps } = await setup();
			const out = await chatTurn(
				{ text: 'hey can you get us like 4 kilos of lactose free butter for tomorrow' },
				{
					...deps,
					models: {
						understand: messyLlm(),
						// The planner model never answers usefully: the script takes every step.
						plan: fake(() => 'no idea'),
						explain: fake(
							() =>
								'4 kg of lactose-free butter is planned; 1 decision waits for you in the Kitchen screen.'
						)
					}
				}
			);
			const steps = out.filter((e) => e.type === 'step');
			expect(steps[0]).toMatchObject({
				tool: 'understand',
				detail: expect.stringMatching(/via Gemini/)
			});
			expect(steps.map((s) => s.type === 'step' && s.tool)).toContain('place_order');
			const ledger = out.find((e) => e.type === 'ledger');
			if (ledger?.type !== 'ledger') throw new Error('no ledger');
			expect(ledger.ledger.needs[0].required).toEqual({ value: 4, unit: 'kg' });
			const ex = steps.find((s) => s.type === 'step' && s.tool === 'explain');
			expect(ex?.type === 'step' && ex.detail).toMatch(/via Gemini · \d+ ms|template/);
		}
	);

	it(
		'a model answer that claims an order without a receipt is replaced by the template',
		{ timeout: 120_000 },
		async () => {
			const { deps } = await setup();
			const out = await chatTurn(
				{ text: 'Order 60 kg butter for Friday' },
				{
					...deps,
					models: {
						explain: fake(() => 'Done! I ordered all 60 kg and the supplier confirmed it.')
					}
				}
			);
			const done = out.at(-1);
			expect(done?.type === 'done' && done.text).toMatch(/no order placed yet/);
			const ex = out.find((e) => e.type === 'step' && e.tool === 'explain');
			expect(ex?.type === 'step' && ex.detail).toMatch(/model reply not used/);
		}
	);

	it('small talk gets a short hello and no task', async () => {
		const { w, deps } = await setup();
		const out = await chatTurn(
			{ text: "thanks, that's great!" },
			{ ...deps, models: { understand: messyLlm() } }
		);
		expect(out).toHaveLength(2);
		expect(out.at(-1)).toMatchObject({ type: 'done', taskId: '' });
		expect(await w.env.ports.tasks!.list(w.env.workspaceId)).toEqual([]);
	});
});

describe('suite: chat v2 · several products in one message', () => {
	it(
		'"tarvitaan 10 kg perunoita ja 5 l maitoa perjantaiksi" orders both on one task',
		{ timeout: 120_000 },
		async () => {
			const { w, deps } = await setup();
			const out = await chatTurn(
				{ text: 'tarvitaan 10 kg perunoita ja 5 l maitoa perjantaiksi' },
				deps
			);
			expect(out.some((e) => e.type === 'clarify')).toBe(false);
			const taskId = out.at(-1)!.taskId;
			const task = await w.env.ports.tasks!.get(w.env.workspaceId, taskId);
			// One plan for the one delivery day; milk has no product /request would pick either, so it is said, not
			// dropped and not guessed.
			expect(task?.plans.map((p) => p.role)).toEqual(['primary']);
			const plans = Object.values((await w.state()).plans);
			expect(plans.map((p) => p.deliverBy)).toEqual(['2026-12-11']);
			expect(out.at(-1)).toMatchObject({ text: expect.stringMatching(/Not ordered: 5 l milk/) });
			const ledger = out.find((e) => e.type === 'ledger');
			if (ledger?.type !== 'ledger') throw new Error('no ledger');
			expect(ledger.ledger.needs.map((n) => n.required)).toEqual([{ value: 10, unit: 'kg' }]);
		}
	);
});

describe('suite: chat turns · tasks opened elsewhere', () => {
	it(
		'a task /request opened (t-<planId>) is joined by its id: questions and continue work',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const placed = await w.handlers.place_order(chef, {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-11',
				idempotencyKey: 'request-task',
				lines: [{ productId: '464411', qty: 8, unit: 'ST' }]
			} as never);
			if (!placed.ok) throw new Error(placed.error.message);
			const link = await taskForPlan({
				tasks: w.env.ports.tasks,
				ctx: chef,
				now: FIDELITY_NOW,
				plan: placed.value.plan,
				title: '4 kg butter',
				requirement: { goal: '4 kg butter for Friday' }
			});
			expect(link.taskId).toMatch(/^t-/);
			expect(isTaskId(link.taskId)).toBe(true);
			const out = await chatTurn({ taskId: link.taskId!, text: 'what is still open?' }, deps);
			expect(out.at(-1)).toMatchObject({ type: 'done', taskId: link.taskId });
			const last = out.at(-1);
			expect(last?.type === 'done' ? last.state : 'none').not.toBe('failed');
			expect((await taskView(link.taskId!, deps)).at(-1)?.type).toBe('done');
		}
	);
});

describe('suite: chat turns · the plan on screen scopes questions, not new orders', () => {
	it(
		'an order typed with the buffet plan on screen starts its own task; a question joins the plan',
		{ timeout: 120_000 },
		async () => {
			const { w, chef, deps } = await setup();
			const planned = await w.handlers.plan_event(chef, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const buffet = planned.value.plan.id;
			const q = await chatTurn({ planId: buffet, text: 'What needs my decision?' }, deps);
			const buffetTask = q.at(-1)!.taskId;
			const order = await chatTurn(
				{ planId: buffet, text: 'Order 4 kg butter for Wednesday' },
				deps
			);
			const orderTask = order.at(-1)!.taskId;
			expect(orderTask).not.toBe(buffetTask);
			const t = await w.env.ports.tasks!.get(w.env.workspaceId, orderTask);
			expect(t?.plans.map((p) => p.planId)).not.toContain(buffet);
			const ledger = order.find((e) => e.type === 'ledger');
			if (ledger?.type !== 'ledger') throw new Error('no ledger');
			expect(ledger.ledger.needs.map((n) => n.required)).toEqual([{ value: 4, unit: 'kg' }]);
			const bt = await w.env.ports.tasks!.get(w.env.workspaceId, buffetTask);
			expect(bt?.plans.map((p) => p.planId)).toEqual([buffet]);
		}
	);
});

describe('suite: chat turns · delivery days', () => {
	it(
		'an order for a day the kitchen does not receive says so in words',
		{ timeout: 120_000 },
		async () => {
			const { w, deps } = await setup();
			// k-lounas receives Monday, Wednesday and Friday.
			const out = await chatTurn(
				{ text: 'Order 4 kg butter for Thursday' },
				{ ...deps, kitchen: { id: 'k-lounas' } }
			);
			const drafted = out.find((e) => e.type === 'step' && e.tool === 'place_order');
			expect(drafted?.type === 'step' && drafted.summary).toMatch(
				/does not receive deliveries on Thursdays/
			);
			void w;
		}
	);
});

describe('suite: chat turns · same words, same basket', () => {
	for (const text of [
		'10 l lactose-free milk for Friday',
		'4 kg butter for Friday',
		'2 l whipping cream for Friday'
	])
		it(`"${text}" buys what /request buys`, { timeout: 120_000 }, async () => {
			const req = await playText('k-hotel', text, 'request', `same-${text}`);
			const { w, deps } = await setup();
			await chatTurn({ text }, deps);
			const chat = Object.values((await w.state()).plans);
			const basket = (ps: typeof chat) =>
				ps.flatMap((p) => p.lines.map((l) => `${l.productId}×${l.qty.value}`)).sort();
			expect(basket(chat)).toEqual(basket(req.plans));
		});
});
