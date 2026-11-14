import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { contextFor } from '$lib/server/auth';
import { resetStub, stubHandlers } from '$lib/server/tools/stub-handlers';
import { runRoutineAgent } from './index';
import { llmPlanner, runAgent, MAX_STEPS } from './loop';

beforeEach(() => resetStub());

const fakeLlm = (replies: string[]): Llm => ({
	generate: async () => ({
		text: replies.shift() ?? '{"done":true,"summary":"out of replies"}',
		model: 'fake',
		tokens: { in: 1, out: 1 },
		latencyMs: 0
	})
});

describe('suite: agent loop', () => {
	it('plans the Christmas buffet offline in ≤8 traced steps without approving or committing', async () => {
		const events: ServerEvent[] = [];
		const run = await runRoutineAgent({
			goal: 'plan the Christmas buffet for 140 at k-hotel',
			env: { LLM_PROVIDER: 'fixture' },
			handlers: stubHandlers,
			onEvent: (e) => events.push(e)
		});
		expect(run.stopped).toBe('done');
		expect(run.steps.length).toBeLessThanOrEqual(MAX_STEPS);
		const tools = run.steps.map((s) => s.tool);
		expect(tools[0]).toBe('plan_event');
		expect(tools).toContain('find_substitutes');
		expect(tools).toContain('get_plan');
		expect(tools).not.toContain('approve');
		expect(tools).not.toContain('commit_order');
		expect(run.steps.every((s) => s.ok)).toBe(true);
		expect(run.summary).toMatch(/held for the chef/);
		const traces = events.filter((e) => e.kind === 'trace');
		expect(traces.filter((e) => e.step === 'tool')).toHaveLength(run.steps.length);
		expect(traces.at(-1)).toMatchObject({ step: 'done', workspaceId: 'ws-demo', runId: 'run-1' });
		// The final trace carries the outcome computed from the plan, not the planner's word.
		expect(traces.at(-1)?.data.outcome).toMatchObject({ intent: 'seeded_event' });
		expect(traces[0].data.intent).toMatchObject({ kind: 'seeded_event', kitchenId: 'k-hotel' });
	});

	it('refuses a model that reaches for a tool outside its scope', async () => {
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: stubHandlers,
			planner: llmPlanner(
				fakeLlm([
					'{"tool":"approve","input":{"approvalId":"a","planVersion":1,"termsHash":"h","decision":"grant"},"why":"just do it"}'
				])
			)
		});
		expect(run.stopped).toBe('planner_error');
		expect(run.steps).toHaveLength(0);
	});

	it('stops at 8 steps even if the model never finishes', async () => {
		const loop = Array.from(
			{ length: 20 },
			() => '{"tool":"search_products","input":{"query":"maito"},"why":"again"}'
		);
		const run = await runAgent({
			goal: 'x',
			ctx: contextFor('kitchen_agent', 't', 'agent'),
			handlers: stubHandlers,
			planner: llmPlanner(fakeLlm(loop))
		});
		expect(run.stopped).toBe('max_steps');
		expect(run.steps).toHaveLength(MAX_STEPS);
	});

	it('runs on the served handlers (real store)', async () => {
		const run = await runRoutineAgent({
			goal: 'plan the Christmas buffet for 140 at k-hotel',
			env: { LLM_PROVIDER: 'fixture' }
		});
		if (process.env.AGENT_LOG)
			for (const st of run.steps) console.log(st.n, st.tool, st.ok ? 'ok' : st.error?.code, st.why);
		if (process.env.AGENT_LOG) console.log(run.summary);
		expect(run.stopped).toBe('done');
		expect(run.outcome?.intent).toBe('seeded_event');
		expect(['awaiting_user', 'partial']).toContain(run.outcome?.status);
	}, 60000);
});
