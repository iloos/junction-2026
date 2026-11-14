/**
 * Suite: agent goal trials · F4 and F25. The routine intent reads quantities, units and dates with the
 * request parser and orders the physical amount asked for; the run's seams (signal to the model, the
 * initiator on the context, plan picked by the request, truncated facts) hold. Runs in `pnpm eval:agent`.
 */
import { describe, expect, it } from 'vitest';
import type { Plan } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { contextFor } from '$lib/server/auth';
import { orderAmount } from '$lib/server/request/convert';
import { resetStub, stubHandlers } from '$lib/server/tools/stub-handlers';
import { pickPlan } from './context';
import { toFacts, type PlanFacts } from './facts';
import { runGoal, scriptedPlanner } from './index';
import { llmPlanner, runAgent } from './loop';
import { trialWorkspace } from './trial-harness';

type W = Awaited<ReturnType<typeof trialWorkspace>>;
const play = (w: W, goal: string, id = 'agent-seam') =>
	runGoal({
		goal,
		principal: w.principal({ id }),
		handlers: w.handlers,
		planner: scriptedPlanner(),
		source: w.source
	});

describe('suite: agent goal trials · F4 routine order via the request parser', () => {
	it(
		'F4 regression: "4 kg butter tomorrow" orders ≥4 kg of butter for tomorrow, not 4 sales units for today+2',
		{
			timeout: 60_000
		},
		async () => {
			const w = await trialWorkspace();
			const run = await play(w, 'Order 4 kg butter for k-lounas tomorrow');
			expect(run.outcome?.intent).toBe('routine_order');
			const place = run.steps.find((s) => s.tool === 'place_order');
			expect(place?.ok).toBe(true);
			const st = await w.state();
			const plan = st.plans[run.outcome!.planId!];
			expect(plan.deliverBy).toBe('2026-11-15'); // tomorrow on the scenario clock (today 2026-11-14)
			expect(plan.lines).toHaveLength(1);
			const line = plan.lines[0];
			const product = (await w.env.ports.catalog.get([line.productId])).get(line.productId)!;
			expect(product.category).toBe('10500'); // butter, not savoy cabbage ("voi" in SAVOIJINKAALI)
			const amount = orderAmount(product, line.qty.value);
			expect(amount?.unit).toBe('kg');
			expect(amount!.value).toBeGreaterThanOrEqual(4);
			expect(line.qty.value).not.toBe(4); // a 4 kg case is one KI, not 4 of them
			// The physical amount travels with the line as a direct need.
			expect((place!.input as { lines: { amount?: unknown }[] }).lines[0].amount).toEqual({
				value: 4,
				unit: 'kg'
			});
			// The planner was told how the quantity was converted.
			expect((place!.why ?? '').toLowerCase()).toMatch(/4 kg .*per/);
		}
	);

	it.each([
		['Order 3 kerma for k-lounas by Monday', /unit/],
		['Order 4 kg butter for k-lounas', /arrive/],
		['Order 4 kg butter for k-lounas by 2026-11-01', /past/]
	])(
		'refuses "%s" with a reason, before any model call or op',
		{ timeout: 60_000 },
		async (goal, why) => {
			const w = await trialWorkspace();
			let calls = 0;
			const run = await runGoal({
				goal,
				principal: w.principal(),
				handlers: w.handlers,
				planner: async () => {
					calls++;
					return { done: true, summary: 'x' };
				},
				source: w.source
			});
			// A clarifying refusal waits for the chef's answer; nothing is ordered meanwhile.
			expect(run.outcome).toMatchObject({ intent: 'unsupported', status: 'awaiting_user' });
			expect(run.outcome?.nextAction ?? run.summary).toMatch(why);
			expect(calls).toBe(0);
			expect(w.ops).toHaveLength(0);
		}
	);
});

describe('suite: agent goal trials · F25 seams', () => {
	it(
		'the plan is picked by the request: event, kitchen, shortage, or ask which',
		{
			timeout: 60_000
		},
		async () => {
			const w = await trialWorkspace();
			await play(w, 'Plan the Christmas buffet for 140 at k-hotel', 'agent-a');
			await play(w, 'Order 4 kg butter for k-lounas by Monday', 'agent-b');
			const plans = Object.values((await w.state()).plans);
			const xmas = plans.find((p) => p.eventId)!;
			const butter = plans.find((p) => !p.eventId)!;
			expect(butter.state).not.toBe('committed'); // held: both plans are open

			const ask = await play(w, 'Show me the plan status', 'agent-c');
			expect(ask.outcome).toMatchObject({ intent: 'unsupported', status: 'awaiting_user' });
			expect(ask.outcome?.nextAction ?? '').toMatch(/Which plan\?/);

			const byKitchen = await play(w, 'Show me the plan status for k-lounas', 'agent-d');
			expect(byKitchen.outcome).toMatchObject({ intent: 'inspect', planId: butter.id });
			const byEvent = await play(w, 'Show me the Christmas plan', 'agent-e');
			expect(byEvent.outcome).toMatchObject({ planId: xmas.id });
			const byShortage = await play(w, 'Find substitutes for the shortages', 'agent-f');
			expect(byShortage.outcome).toMatchObject({ intent: 'shortage_repair', planId: xmas.id });
		}
	);

	it('pickPlan: a named id wins; an event with no open plan picks nothing', () => {
		const p = (id: string, kitchenId: string, eventId?: string) =>
			({ id, kitchenId, eventId, lines: [], state: 'quoted' }) as unknown as Plan;
		const open = [p('pl-a', 'k-hotel', 'event-xmas-140'), p('pl-b', 'k-hotel')];
		expect(pickPlan('explain pl-b', open)).toMatchObject({
			plan: { id: 'pl-b' },
			pickedBy: 'named'
		});
		expect(pickPlan('show the xmas plan', open)).toMatchObject({ pickedBy: 'event' });
		expect(pickPlan('show the plan for k-hotel', open)).toBeNull();
		expect(pickPlan('show the xmas plan', [open[1]])).toBeNull();
		expect(pickPlan('status', [open[1]])).toMatchObject({ pickedBy: 'only' });
	});

	it('facts cut at the cap say so, with the full count', () => {
		const lines = Array.from({ length: 45 }, (_, i) => ({
			id: `l${i}`,
			productId: `${i}`,
			qty: { value: 1, unit: 'ST' },
			state: 'eligible',
			reasons: []
		}));
		const f = toFacts('get_plan', { plan: { id: 'pl', lines, needs: [] }, approval: null });
		const plan = f.plan as PlanFacts;
		expect(plan.lines).toHaveLength(40);
		expect(plan.truncated).toEqual({ lines: 45 });
		const small = toFacts('get_plan', { plan: { id: 'pl', lines: lines.slice(0, 3), needs: [] } });
		expect((small.plan as PlanFacts).truncated).toBeUndefined();
		const s = toFacts('search_products', {
			products: Array.from({ length: 12 }, (_, i) => ({ productId: `${i}`, salesUnit: 'ST' }))
		});
		expect(s.truncated).toEqual({ products: 12 });
	});

	it('the run signal reaches llm.generate and aborts it on cancel', async () => {
		resetStub();
		const seen: AbortSignal[] = [];
		const llm: Llm = {
			generate: (req) =>
				new Promise((_, reject) => {
					if (req.signal) seen.push(req.signal);
					req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				})
		};
		const stop = new AbortController();
		const p = runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: stubHandlers,
			planner: llmPlanner(llm),
			signal: stop.signal
		});
		await new Promise((r) => setTimeout(r, 10));
		stop.abort();
		const run = await p;
		expect(run.stopped).toBe('cancelled');
		expect(seen).toHaveLength(1);
		expect(seen[0].aborted).toBe(true);
	});
});
