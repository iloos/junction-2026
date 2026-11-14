import { describe, expect, it } from 'vitest';
import type { Decide, Decision } from '$lib/core/ports';
import { parseRules } from '$lib/server/request/parse';
import {
	outcomeTextCheckpoint,
	requestParseCheckpoint,
	review,
	ReviewBudget,
	withReview,
	type OutcomeFacts
} from './index';

const facts = (o: Partial<OutcomeFacts> = {}): OutcomeFacts => ({
	status: 'awaiting_user',
	unresolvedNeeds: 0,
	committedLines: 0,
	approvalsGranted: 0,
	supplierConfirmedLines: 0,
	...o
});
const goal = { goal: 'Plan the Christmas buffet for 140 at k-hotel' };
const scorer = (value: number, source: Decision<number>['source'] = 'gemini') => {
	const calls: string[] = [];
	const decide = {
		score: async (q: { context: string }) => {
			calls.push(q.context);
			return { value, confidence: 0.9, source, latencyMs: 1 };
		}
	} as unknown as Decide;
	return { decide, calls };
};

describe('review: agent outcome text (D10)', () => {
	it('revises a stronger claim than the state supports', async () => {
		const v = await review(outcomeTextCheckpoint, {
			input: goal,
			output: 'All done, buffet fully ordered and supplier confirmed.',
			facts: facts({ unresolvedNeeds: 2 })
		});
		expect(v.kind).toBe('revise');
		if (v.kind !== 'revise') return;
		expect(v.feedback).toMatch(/not fulfilled/);
		expect(v.feedback).toMatch(/supplier confirmed/);
		expect(v.feedback).toMatch(/Nothing was committed/);
		expect(v.feedback).toMatch(/2 need\(s\) are unresolved/);
	});

	it('blocks a claimed authority action', async () => {
		const v = await review(outcomeTextCheckpoint, {
			input: goal,
			output: 'I approved the held lines and raised the cap.',
			facts: facts()
		});
		expect(v.kind).toBe('block');
	});

	it('passes a truthful summary, negations included', async () => {
		const v = await review(outcomeTextCheckpoint, {
			input: goal,
			output:
				'Planned 12 lines; 3 held for the chef, not approved yet; 1 need still unresolved (no substitute).',
			facts: facts({ unresolvedNeeds: 1 })
		});
		expect(v).toEqual({ kind: 'pass' });
	});

	it('a model score below the bar revises; an offline rules score never does', async () => {
		const low = scorer(1);
		const truthful = { input: goal, output: 'Planned; 3 held for the chef.', facts: facts() };
		expect((await review(outcomeTextCheckpoint, truthful, { decide: low.decide })).kind).toBe(
			'revise'
		);
		const offline = scorer(0, 'rules');
		expect(await review(outcomeTextCheckpoint, truthful, { decide: offline.decide })).toEqual({
			kind: 'pass',
			notes: ['not scored offline']
		});
	});

	it('the per-job budget caps model calls; reviews still run their checks', async () => {
		const s = scorer(4);
		const budget = new ReviewBudget(1);
		const c = { input: goal, output: 'Planned; 3 held for the chef.', facts: facts() };
		await review(outcomeTextCheckpoint, c, { decide: s.decide, budget });
		await review(outcomeTextCheckpoint, c, { decide: s.decide, budget });
		expect(s.calls).toHaveLength(1);
		const bad = await review(
			outcomeTextCheckpoint,
			{ ...c, output: 'Everything is ordered.' },
			{ decide: s.decide, budget }
		);
		expect(bad.kind).toBe('revise');
	});

	it('is traced', async () => {
		const seen: Record<string, unknown>[] = [];
		await review(
			outcomeTextCheckpoint,
			{ input: goal, output: 'Fully covered.', facts: facts() },
			{ trace: (_s, d) => seen.push(d) }
		);
		expect(seen[0]).toMatchObject({
			kind: 'review',
			checkpoint: 'agent.outcome_text',
			verdict: 'revise'
		});
	});
});

describe('review: bounded retry', () => {
	it('revise → one retry with the feedback → pass', async () => {
		const asked: (string | undefined)[] = [];
		const r = await withReview(outcomeTextCheckpoint, {
			input: goal,
			facts: facts(),
			produce: (fb) => {
				asked.push(fb);
				return fb ? 'Planned; 3 held for the chef.' : 'All done.';
			}
		});
		expect(r).toMatchObject({ attempts: 2, verdict: { kind: 'pass' } });
		expect(asked[0]).toBeUndefined();
		expect(asked[1]).toMatch(/not fulfilled/);
	});

	it('never more than two productions', async () => {
		let n = 0;
		const r = await withReview(outcomeTextCheckpoint, {
			input: goal,
			facts: facts(),
			produce: () => {
				n++;
				return 'All done.';
			}
		});
		expect(n).toBe(2);
		expect(r.verdict.kind).toBe('revise');
	});
});

describe('review: request parse (nothing from the words lost)', () => {
	const today = '2026-11-14';
	it('passes a complete rules parse', async () => {
		const text = '200 kg potatoes and 1,000 l lactose-free milk by Friday';
		const v = await review(requestParseCheckpoint, {
			input: { text },
			output: {
				...parseRules(text, today),
				parser: { kind: 'rules', model: 'rules', latencyMs: 0 }
			},
			facts: null
		});
		expect(v).toEqual({ kind: 'pass' });
	});

	it('names the words and numbers a parse dropped', async () => {
		const text = '200 kg potatoes and 2 l lactose-free milk by Friday';
		const full = parseRules(text, today);
		// A model parse that kept the potatoes and lost the milk line.
		const lossy = {
			...full,
			items: full.items.slice(0, 1),
			parser: { kind: 'gemini' as const, model: 'm', latencyMs: 0 }
		};
		const v = await review(requestParseCheckpoint, { input: { text }, output: lossy, facts: null });
		expect(v.kind).toBe('revise');
		if (v.kind !== 'revise') return;
		expect(v.feedback).toMatch(/"lactose-free"/);
		expect(v.feedback).toMatch(/"milk"/);
		expect(v.feedback).toMatch(/numbers .*: 2/);
	});

	it.each([
		['2 x 10 kg butter by Friday', 'pass'],
		['4×5 l cream by Friday', 'pass'],
		['eggs for 300 breakfasts by Friday', 'pass'],
		['200 kg potatoes for 300 breakfasts by Friday', 'revise']
	])('%s → %s (a cover count the parse drops silently is flagged)', async (text, kind) => {
		const v = await review(requestParseCheckpoint, {
			input: { text },
			output: {
				...parseRules(text, today),
				parser: { kind: 'rules', model: 'rules', latencyMs: 0 }
			},
			facts: null
		});
		expect(v.kind).toBe(kind);
	});
});
