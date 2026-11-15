/**
 * "Every model call is traced": the chat's own jobs (chat.understand, menu.propose) go through the router built
 * without a trace of its own, so each call must reach the caller's scope trace (the chat route and serveTool enter
 * withCallScope) with the job, model, tokens and latency.
 */
import { describe, expect, it } from 'vitest';
import { createLlmRouter } from '../adapters/llm/router';
import { withExternalScope } from '../external/scope';

describe('the chat model jobs reach the trace drawer', () => {
	for (const job of ['chat.understand', 'menu.propose'] as const)
		it(`${job} traces through the caller's scope`, async () => {
			const seen: { step: string; data: Record<string, unknown> }[] = [];
			const router = createLlmRouter({ LLM_PROVIDER: 'fixture' } as never);
			await withExternalScope(
				{ workspaceId: 'ws-trace', trace: (step, data) => seen.push({ step, data: data ?? {} }) },
				async () => {
					await router
						.for(job)
						.generate({ system: 's', prompt: '{"message":"4 kg butter"}', maxTokens: 50 })
						.catch(() => undefined);
				}
			);
			const call = seen.find((s) => s.data.job === job);
			expect(call, JSON.stringify(seen).slice(0, 300)).toBeTruthy();
			expect(call!.data).toHaveProperty('model');
		});
});
