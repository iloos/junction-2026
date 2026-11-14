import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { runGoal } from './index';
import type { Planner } from './loop';
import { trialWorkspace } from './trial-harness';

const saysDone: Planner = async () => ({ done: true, summary: 'All done, buffet fully ordered.' });

describe('agent outcome review (REVIEW flag)', () => {
	it(
		'an overclaiming planner summary is replaced by the domain text; the outcome is untouched',
		{
			timeout: 60_000
		},
		async () => {
			const w = await trialWorkspace();
			const events: ServerEvent[] = [];
			const run = await runGoal({
				goal: 'Plan the Christmas buffet for 140 at k-hotel',
				principal: w.principal(),
				handlers: w.handlers,
				planner: saysDone,
				source: w.source,
				onEvent: (e) => events.push(e),
				review: { deps: {} }
			});
			expect(run.outcome?.status).toBe('blocked');
			expect(run.plannerSummary).toBe(run.outcome?.nextAction);
			expect(run.summary).not.toMatch(/fully ordered/);
			const reviews = events.filter(
				(e) => e.kind === 'trace' && e.step === 'decision' && e.data.kind === 'review'
			);
			expect(reviews.map((e) => e.kind === 'trace' && e.data.verdict)).toEqual(['revise', 'pass']);
		}
	);

	it('with a model, revise rewrites once with the critique', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const prompts: string[] = [];
		const llm: Llm = {
			generate: async (req) => {
				prompts.push(req.prompt);
				return {
					text: 'Nothing was planned yet; the buffet is still open.',
					model: 'fake',
					tokens: { in: 1, out: 1 },
					latencyMs: 0
				};
			}
		};
		const run = await runGoal({
			goal: 'Plan the Christmas buffet for 140 at k-hotel',
			principal: w.principal(),
			handlers: w.handlers,
			planner: saysDone,
			source: w.source,
			review: { deps: {}, llm }
		});
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toMatch(/not fulfilled/);
		expect(run.plannerSummary).toBe('Nothing was planned yet; the buffet is still open.');
	});
});
