import { beforeEach, describe, expect, it } from 'vitest';
import { ExternalCallTrace } from '$lib/core/contracts/task';
import { resetBreakers } from '../../external/breaker';
import { LimitError } from '../../external/ledger';
import { withExternalScope } from '../../external/scope';
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

describe('live jobs through the outside-call helper', () => {
	beforeEach(() => resetBreakers());
	const fake = () => ({
		generate: async () => ({
			text: '{}',
			model: 'gemini-3.5-flash-lite',
			tokens: { in: 50, out: 20 },
			latencyMs: 5
		})
	});

	it('traces each call into the caller scope as an ExternalCallTrace with its job', async () => {
		const seen: Record<string, unknown>[] = [];
		const router = createLlmRouter(
			{ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
			undefined,
			LLM_ROUTES,
			fake
		);
		await withExternalScope({ workspaceId: 'ws-j-1', trace: (_s, d) => void seen.push(d) }, () =>
			router.for('request.parse').generate({ prompt: 'x', maxTokens: 50 })
		);
		expect(seen).toHaveLength(1);
		expect(ExternalCallTrace.safeParse(seen[0]).success).toBe(true);
		expect(seen[0]).toMatchObject({
			api: 'gemini',
			cache: 'live',
			job: 'request.parse',
			purpose: 'request.parse',
			workspaceId: 'ws-j-1',
			tokensIn: 50,
			costUnits: 70
		});
	});

	it('a visitor over its daily cap is refused before the call is sent', async () => {
		let sent = 0;
		const router = createLlmRouter(
			{ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', LLM_CAP_PER_WORKSPACE: '1' },
			() => {},
			LLM_ROUTES,
			() => ({ generate: async () => (sent++, fake().generate()) })
		);
		await withExternalScope({ workspaceId: `ws-cap-${Date.now()}` }, async () => {
			await router.for('explain').generate({ prompt: 'a', maxTokens: 10 });
			await expect(
				router.for('explain').generate({ prompt: 'b', maxTokens: 10 })
			).rejects.toBeInstanceOf(LimitError);
		});
		expect(sent).toBe(1);
	});
});
