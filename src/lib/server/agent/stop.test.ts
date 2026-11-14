import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolName } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { contextFor } from '$lib/server/auth';
import { resetStub, stubHandlers } from '$lib/server/tools/stub-handlers';
import { runGoal } from './index';
import { runAgent, scriptedPlanner, type Planner } from './loop';
import { trialWorkspace } from './trial-harness';

beforeEach(() => resetStub());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stub handlers that count every handler call (a call = a side effect could have started). */
function counted(base: ToolHandlers = stubHandlers, delay: Partial<Record<ToolName, number>> = {}) {
	const calls: ToolName[] = [];
	const h = Object.fromEntries(
		Object.entries(base).map(([name, fn]) => [
			name,
			async (ctx: unknown, input: unknown) => {
				calls.push(name as ToolName);
				if (delay[name as ToolName]) await sleep(delay[name as ToolName]!);
				return (fn as (c: unknown, i: unknown) => Promise<unknown>)(ctx, input);
			}
		])
	) as unknown as ToolHandlers;
	return { h, calls };
}

const search: Planner = async () => ({
	tool: 'search_products',
	input: { query: 'maito' },
	why: 'again'
});

describe('deadline and cancel (finding C)', () => {
	// Deadlines are driven through `deadlineSignal`, so these tests never depend on timer precision or load.
	const longDeadline = 60_000;

	it('a slow planner past the deadline dispatches zero tools', async () => {
		const { h, calls } = counted();
		const deadline = new AbortController();
		const slow: Planner = async (s, signal) => {
			deadline.abort(); // the deadline passes while the planner is still thinking
			await new Promise((r) => setTimeout(r, 0));
			return search(s, signal);
		};
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: h,
			planner: slow,
			deadlineMs: longDeadline,
			deadlineSignal: deadline.signal
		});
		expect(run.stopped).toBe('deadline');
		expect(run.steps).toHaveLength(0);
		expect(calls).toEqual([]);
	});

	it('a planner that never answers is released at the deadline', async () => {
		const { h, calls } = counted();
		const deadline = new AbortController();
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: h,
			planner: () => {
				deadline.abort();
				return new Promise(() => {});
			},
			deadlineMs: longDeadline,
			deadlineSignal: deadline.signal
		});
		expect(run.stopped).toBe('deadline');
		expect(calls).toEqual([]);
	});

	it('the wall-clock deadline also stops a planner that never answers', async () => {
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: counted().h,
			planner: () => new Promise(() => {}),
			deadlineMs: 20
		});
		// Whether the timer or the clock check sees it first, it is a deadline, never a planner error.
		expect(run.stopped).toBe('deadline');
	});

	it('a slow tool finishes and is recorded, then nothing else starts', async () => {
		const deadline = new AbortController();
		const { h: base, calls } = counted();
		const h = {
			...base,
			search_products: async (ctx, input) => {
				deadline.abort(); // the deadline passes while the tool runs
				return base.search_products(ctx, input);
			}
		} as ToolHandlers;
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: h,
			planner: search,
			deadlineMs: longDeadline,
			deadlineSignal: deadline.signal
		});
		expect(run.stopped).toBe('deadline');
		expect(calls).toEqual(['search_products']);
		expect(run.steps).toHaveLength(1);
		expect(run.steps[0].ok).toBe(true);
	});

	it('cancel while the planner thinks: the commit it then asks for never starts', async () => {
		const { h, calls } = counted();
		const stop = new AbortController();
		const planner: Planner = async () => {
			stop.abort(); // the chef presses Stop while the model is deciding
			await sleep(5);
			return {
				tool: 'commit_order',
				input: { planId: 'stub-p', version: 1, idempotencyKey: 'k' },
				why: 'commit'
			};
		};
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: h,
			planner,
			signal: stop.signal
		});
		expect(run.stopped).toBe('cancelled');
		expect(calls).toEqual([]);
	});

	it('an already-cancelled run starts nothing', async () => {
		const { h, calls } = counted();
		const stop = new AbortController();
		stop.abort();
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: h,
			planner: search,
			signal: stop.signal
		});
		expect(run.stopped).toBe('cancelled');
		expect(calls).toEqual([]);
	});

	it('cancel before commit on the real store: no CommitOrder op, outcome from the plan', async () => {
		const w = await trialWorkspace();
		const stop = new AbortController();
		const script = scriptedPlanner();
		// The scripted routine order: search → place → commit. Stop arrives while it decides on the commit.
		const planner: Planner = async (s, signal) => {
			const a = await script(s, signal);
			if ('tool' in a && a.tool === 'commit_order') stop.abort();
			return a;
		};
		const run = await runGoal({
			goal: 'Order 3 packs kerma for k-lounas by Monday',
			principal: w.principal(),
			handlers: w.handlers,
			planner,
			source: w.source,
			signal: stop.signal
		});
		expect(run.stopped).toBe('cancelled');
		expect(run.steps.map((s) => s.tool)).toEqual(['search_products', 'place_order']);
		expect(w.ops.some((o) => o.op.type === 'CommitOrder')).toBe(false);
		expect(Object.keys((await w.state()).orders)).toHaveLength(0);
		// The plan stays inspectable; the outcome says what is left, not "done".
		expect(run.outcome?.status).toBe('partial');
		expect(run.outcome?.reason).toBe('run stopped: cancelled');
	});
});

describe('stop agent vs stop watching (finding C)', () => {
	it('cancelAgentRun stops the registered run; only the running id can be cancelled', async () => {
		const { startAgentRun, cancelAgentRun, agentRunning } = await import('./runs');
		const started = startAgentRun({ env: { LLM_PROVIDER: 'fixture' } });
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		expect(cancelAgentRun('agent-other', { kind: 'chef', id: 'c' })).toEqual({
			ok: false,
			reason: 'not_running'
		});
		const c = cancelAgentRun(started.id, { kind: 'chef', id: 'c' });
		expect(c.ok).toBe(true);
		const run = await started.done;
		expect(run.stopped).toBe('cancelled');
		expect(run.steps).toHaveLength(0);
		expect(agentRunning()).toBeNull();
	}, 60_000);
});
