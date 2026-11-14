import { describe, expect, it } from 'vitest';
import { geminiKey, geminiLlm } from '../adapters/llm';
import { createDbPorts } from '../store/db-ports';
import { goldenBrief } from './golden';
import { proposeMenu } from './proposal';
import { blocks } from './rubric';
import { memoryMenuStore } from './store';

/**
 * The menu proposal's Gemini path on both golden briefs against the real API: two calls, opt-in.
 *   DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/menu/live.test.ts
 */
describe.skipIf(process.env.DECIDE_LIVE !== '1')('menu proposal, live Gemini', () => {
	for (const name of ['five-star', 'christmas'])
		it(`${name}: the model's menu passes the rubric`, async () => {
			const env = await createDbPorts();
			const r = await proposeMenu({
				kitchenId: 'k-hotel',
				workspaceId: 'ws-live',
				brief: goldenBrief(name),
				store: memoryMenuStore(),
				catalog: env.ports.catalog,
				now: new Date(),
				llm: geminiLlm(geminiKey(process.env as never)!)
			});
			console.info('[live menu]', name, JSON.stringify({ model: r.model, issues: r.issues }));
			expect(r.fallback).toBeUndefined();
			expect(r.proposal.provenance.source).toBe('llm');
			expect(blocks(r.issues)).toEqual([]);
		}, 60_000);
});
