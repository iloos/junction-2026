import { join } from 'node:path';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { replayLlm } from '$lib/server/evals/replay-llm';

/**
 * Recorded live `chat.understand` readings of evals/agent/chat-messy.json at the Llm port (the evals replay wrapper),
 * so tests read real model output offline. Re-record online with `CHAT_RECORD=1 LLM_PROVIDER=gemini node
 * --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/chat/understand.test.ts`.
 */
export const MESSY_REPLAY = join(process.cwd(), 'evals', 'agent', 'chat-messy.replay.json');

export const messyLlm = () =>
	process.env.CHAT_RECORD === '1'
		? replayLlm({
				path: MESSY_REPLAY,
				inner: createLlmRouter(process.env).for('chat.understand'),
				record: true
			})
		: replayLlm({ path: MESSY_REPLAY });
