import { describe, expect, it } from 'vitest';
import { createLlmRouter, LLM_JOBS, LLM_ROUTES } from './router';

describe('llm.for(job)', () => {
	it('every job is routed, traced with its job, and capped at its ceiling', async () => {
		const seen: Record<string, unknown>[] = [];
		const llm = createLlmRouter({ LLM_PROVIDER: 'fixture' }, (_s, d) => seen.push(d));
		for (const job of LLM_JOBS) await llm.for(job).generate({ prompt: 'x', maxTokens: 99_999 });
		expect(seen.map((d) => d.job)).toEqual([...LLM_JOBS]);
		expect(seen.map((d) => d.maxTokens)).toEqual(LLM_JOBS.map((j) => LLM_ROUTES[j].maxTokens));
		expect(seen.every((d) => d.source === 'fixture')).toBe(true);
	});

	it('fixture mode stays on the fixture whatever the table says', async () => {
		const seen: Record<string, unknown>[] = [];
		const llm = createLlmRouter({ LLM_PROVIDER: 'fixture', GEMINI_API_KEY: 'k' }, (_s, d) =>
			seen.push(d)
		);
		await llm.for('agent.plan').generate({ prompt: 'x', maxTokens: 10 });
		expect(seen[0]).toMatchObject({ source: 'fixture', job: 'agent.plan' });
	});
});
