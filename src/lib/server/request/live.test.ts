import { describe, expect, it } from 'vitest';
import { geminiKey, geminiLlm } from '../adapters/llm';
import { parseRequest } from './parse';

/**
 * The request parser's Gemini path against the real API: one call, opt-in.
 *   DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/request/live.test.ts
 */
describe.skipIf(process.env.DECIDE_LIVE !== '1')('request parse, live Gemini', () => {
	it("parses Valio's example through the model, dates from the clock, no disagreement", async () => {
		const llm = geminiLlm(geminiKey(process.env as never)!);
		const r = await parseRequest('1,000 L lactose-free milk by Monday', {
			today: '2026-11-14',
			llm,
			llmKind: 'gemini'
		});
		console.info(
			'[live parse]',
			JSON.stringify({
				parser: r.parser,
				items: r.items,
				deliverBy: r.deliverBy,
				ambiguities: r.ambiguities
			})
		);
		expect(r.parser.fallback).toBeUndefined();
		expect(r.parser.kind).toBe('gemini');
		expect(r.parser.model).toContain('flash-lite');
		expect(r.items[0]).toMatchObject({
			product: 'milk',
			qty: 1000,
			unit: 'l',
			constraints: ['lactose_free']
		});
		expect(r.items[0].ambiguities).toEqual([]);
		expect(r.deliverBy).toBe('2026-11-16');
	}, 30_000);
});
