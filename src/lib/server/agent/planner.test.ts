import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { actionJsonSchema, llmPlanner } from './loop';

/** A model that answers from a script and records what it was sent. */
function scripted(replies: string[]) {
	const sent: Parameters<Llm['generate']>[0][] = [];
	const llm: Llm = {
		async generate(req) {
			sent.push(req);
			return {
				text: replies[sent.length - 1] ?? '{}',
				model: 'm',
				tokens: { in: 1, out: 1 },
				latencyMs: 0
			};
		}
	};
	return { llm, sent };
}
const state = { goal: 'g', tools: ['get_plan', 'commit_order'] as const, history: [] };

describe('LLM planner: response schema and one corrective retry (review §ranked 7)', () => {
	it('sends a schema that only allows the run tools', async () => {
		const { llm, sent } = scripted(['{"tool":"get_plan","input":{"planId":"p"},"why":"read"}']);
		const a = await llmPlanner(llm)(
			{ ...state, tools: [...state.tools] },
			new AbortController().signal
		);
		expect(a).toEqual({ tool: 'get_plan', input: { planId: 'p' }, why: 'read' });
		const schema = JSON.stringify((sent[0] as { schema?: unknown }).schema);
		expect(schema).toContain('commit_order');
		expect(schema).not.toContain('approve');
		expect(JSON.stringify(actionJsonSchema(['get_plan']))).toContain('"done"');
	});

	it('a bad reply gets one retry with the reason; a second bad reply fails the step', async () => {
		const ok = scripted(['not json', '{"done":true,"summary":"held for the chef"}']);
		expect(
			await llmPlanner(ok.llm)({ ...state, tools: [...state.tools] }, new AbortController().signal)
		).toEqual({
			done: true,
			summary: 'held for the chef'
		});
		expect(ok.sent[1].prompt).toMatch(/rejected: the reply was not one JSON object/);

		const bad = scripted([
			'{"tool":"approve","input":{},"why":"x"}',
			'{"tool":"set_mandate","input":{},"why":"x"}'
		]);
		await expect(
			llmPlanner(bad.llm)({ ...state, tools: [...state.tools] }, new AbortController().signal)
		).rejects.toThrow(/outside its scope: set_mandate/);
		expect(bad.sent).toHaveLength(2);
	});
});
