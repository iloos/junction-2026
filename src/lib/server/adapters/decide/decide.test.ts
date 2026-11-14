import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@google/genai';
import { ExternalCallTrace } from '$lib/core/contracts/task';
import { resetBreakers } from '../../external/breaker';
import { createSpendLedger } from '../../external/ledger';
import { withExternalScope } from '../../external/scope';
import { createDecide, replayKey, scoreCriteria, type ReplayBook } from './index';

beforeEach(() => resetBreakers());

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
					answers: { q0: { type: 'noul', noul: 0.04, confidence: 0.96 } },
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

	it("batch: one call per shared context, p and probabilities kept, ids are the caller's", async () => {
		const bodies: { questions: Record<string, { type: string }> }[] = [];
		const d = createDecide({
			env: { LLM_PROVIDER: 'gemini' },
			gemini: {
				create: async (b) => {
					bodies.push(b as never);
					return {
						answers: {
							q0: {
								type: 'score',
								score: 3.39,
								confidence: 0.5,
								probabilities: { '0': 0.001, '1': 0.011, '2': 0.086, '3': 0.399, '4': 0.504 }
							},
							q1: { type: 'noul', noul: 0.99, confidence: 0.99 },
							q2: { type: 'noul', noul: 0.9, confidence: 0.9 }
						},
						usage: { total_input_tokens: 900 }
					};
				}
			}
		});
		const ctx = '{"line":"salmon","candidates":[...]}';
		const r = await d.batch!([
			{ id: 'trout.fit', kind: 'score', question: 'fit?', rubric: 'r', max: 4, context: ctx },
			{ id: 'shrimp_violates', kind: 'yes_no', question: 'violates?', context: ctx },
			{ id: 'trout_fi', kind: 'yes_no', question: 'Finnish?', context: ctx }
		]);
		expect(bodies).toHaveLength(1);
		expect(Object.keys(bodies[0].questions)).toEqual(['q0', 'q1', 'q2']);
		expect(r['trout.fit']).toMatchObject({ value: 3.39, source: 'gemini', confidence: 0.5 });
		expect(r['trout.fit'].probabilities?.['4']).toBe(0.504);
		expect(r.shrimp_violates).toMatchObject({ value: true, p: 0.99, source: 'gemini' });
		// Asked again: answered from the process memo, no second call.
		await d.batch!([{ id: 'x', kind: 'yes_no', question: 'violates?', context: ctx }]);
		expect(bodies).toHaveLength(1);
	});

	it('retries once on a 429, then falls back to replay or rules labelled as such', async () => {
		let calls = 0;
		const d = createDecide({
			env: { LLM_PROVIDER: 'gemini' },
			sleep: async () => {},
			gemini: {
				create: async () => {
					calls++;
					throw new ApiError({ message: 'RESOURCE_EXHAUSTED', status: 429 });
				}
			}
		});
		const r = await d.yesNo({ question: 'x?', context: 'y' });
		expect(calls).toBe(2);
		expect(r.source).toBe('rules');
		// The breaker is open now: the next question is not sent.
		await d.yesNo({ question: 'z?', context: 'y' });
		expect(calls).toBe(2);
	});

	it('traces ExternalCallTrace into the caller scope and charges the visitor workspace', async () => {
		const spend = createSpendLedger();
		const seen: Record<string, unknown>[] = [];
		const d = createDecide({
			env: { LLM_PROVIDER: 'gemini', DECIDE_CAP_PER_WORKSPACE: '1' },
			spend,
			gemini: {
				create: async () => ({ answers: { q0: { type: 'noul', noul: 0.2, confidence: 0.8 } } })
			}
		});
		await withExternalScope(
			{ workspaceId: 'ws-visitor', trace: (_s, data) => void seen.push(data) },
			async () => {
				expect((await d.yesNo({ question: 'a?', context: 'c' })).source).toBe('gemini');
				// Over the visitor's daily cap: answered by rules, nothing sent.
				expect((await d.yesNo({ question: 'b?', context: 'c' })).source).toBe('rules');
			}
		);
		expect(spend.usage().counts['gemini-decide']?.keys['ws-visitor']).toBe(1);
		expect(ExternalCallTrace.safeParse(seen[0]).success).toBe(true);
		expect(seen[0]).toMatchObject({ cache: 'live', workspaceId: 'ws-visitor' });
		expect(seen.at(-1)).toMatchObject({ cache: 'fixture', source: 'rules' });
	});

	it('records live answers to the replay book and replays them offline with p', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'decide-rec-'));
		const path = join(dir, 'r.json');
		writeFileSync(path, '{}');
		const rec = createDecide({
			env: { LLM_PROVIDER: 'gemini' },
			replayPath: path,
			record: true,
			gemini: {
				create: async () => ({ answers: { q0: { type: 'noul', noul: 0.97, confidence: 0.97 } } })
			}
		});
		await rec.yesNo({ question: 'Contains "shrimp"?', context: 'Product: katkarapu' });
		const off = createDecide({ env: { LLM_PROVIDER: 'fixture' }, replayPath: path });
		expect(
			await off.yesNo({ question: 'Contains "shrimp"?', context: 'Product: katkarapu' })
		).toMatchObject({
			value: true,
			p: 0.97,
			source: 'replay'
		});
	});
});
