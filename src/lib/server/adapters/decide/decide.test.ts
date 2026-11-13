import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDecide, replayKey, scoreCriteria, type ReplayBook } from './index';

describe('decide adapter', () => {
	it('answers from rules in fixture mode without touching the client', async () => {
		let calls = 0;
		const d = createDecide({
			env: { LLM_PROVIDER: 'fixture' },
			gemini: {
				create: async () => {
					calls++;
					return {};
				}
			}
		});
		const r = await d.yesNo({
			question: 'Does it contain "shellfish"?',
			context: 'shrimp, shellfish, salt'
		});
		expect(r).toMatchObject({ value: true, source: 'rules' });
		const s = await d.score({ question: 'fit?', rubric: 'fit', max: 4, context: '' });
		expect(s).toMatchObject({ value: 2, source: 'rules' });
		expect(calls).toBe(0);
	});

	it('replays a recorded answer by question hash', async () => {
		const q = { question: 'tier?', options: ['act', 'propose'] as const, context: 'c' };
		const k = await replayKey({ kind: 'choice', ...q });
		const book: ReplayBook = {
			[k]: { value: 'propose', confidence: 0.81, model: 'gemini-decision-1' }
		};
		const dir = mkdtempSync(join(tmpdir(), 'decide-'));
		writeFileSync(join(dir, 'r.json'), JSON.stringify(book));
		const d = createDecide({ env: { LLM_PROVIDER: 'fixture' }, replayPath: join(dir, 'r.json') });
		expect(await d.choice(q)).toMatchObject({
			value: 'propose',
			confidence: 0.81,
			source: 'replay'
		});
	});

	it('maps a live Gemini answer and falls back to rules when the call fails', async () => {
		const events: string[] = [];
		const trace = (step: string, data: Record<string, unknown>) =>
			events.push(`${step}:${data.source}`);
		const ok = createDecide({
			env: { LLM_PROVIDER: 'gemini' },
			trace,
			gemini: {
				create: async () => ({
					answers: { q: { type: 'noul', noul: 0.04, confidence: 0.96 } },
					usage: { total_input_tokens: 120 }
				})
			}
		});
		expect(await ok.yesNo({ question: 'human?', context: '{}' })).toMatchObject({
			value: false,
			confidence: 0.96,
			source: 'gemini'
		});
		const broken = createDecide({
			env: { LLM_PROVIDER: 'gemini' },
			trace,
			gemini: {
				create: async () => {
					throw new Error('429 RESOURCE_EXHAUSTED');
				}
			}
		});
		expect((await broken.yesNo({ question: 'x?', context: '' })).source).toBe('rules');
		expect(events).toEqual(['decision:gemini', 'error:gemini', 'decision:rules']);
	});

	it('uses the rubric lines as score levels when they match max+1', () => {
		expect(scoreCriteria('bad;ok;good', 2)).toEqual(['bad', 'ok', 'good']);
		expect(scoreCriteria('fit', 2)).toHaveLength(3);
	});
});
