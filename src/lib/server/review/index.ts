import type { Decide } from '$lib/core/ports';
import type { Trace } from '$lib/server/adapters/llm/trace';

/**
 * Review: a validator pass at a model-output checkpoint. It sees the whole case (input, output, the facts the
 * output may rely on) and a written rubric, and answers pass, revise (with feedback for one bounded retry of
 * the producer) or block (with the reason to show). It judges text and readings only: it never authorises
 * anything, never changes state and never overrides the tool gate, which still decides every action.
 *
 * Two layers: deterministic checks per checkpoint (always on, free, the same offline), then an optional rubric
 * score through Gemini Decisions (`decide.score`). A score that came from the offline rules fallback is not a
 * judgement, so it never revises or blocks. Every review is traced; model calls are capped per job.
 */

export type Verdict =
	| { kind: 'pass'; notes?: string[] }
	| { kind: 'revise'; feedback: string }
	| { kind: 'block'; reason: string };

export interface Finding {
	severity: 'revise' | 'block';
	/** Our own words: what is wrong and what the producer should do instead. */
	message: string;
}

export interface ReviewCase<I, O, F> {
	input: I;
	output: O;
	facts: F;
}

export interface Checkpoint<I, O, F> {
	/** Stable id, e.g. "agent.outcome_text"; it names the trace and the cost bucket. */
	id: string;
	/** What a good output does, for the scorer and for humans reading the trace. */
	rubric: string;
	/** Deterministic checks. Any `block` finding blocks; any `revise` finding revises. */
	check(c: ReviewCase<I, O, F>): Finding[];
	/** Optional model score: the question and the bounded context it is asked over. */
	score?: {
		question: string;
		max: number;
		/** Lowest passing score. */
		pass: number;
		context(c: ReviewCase<I, O, F>): string;
	};
}

export interface ReviewDeps {
	decide?: Decide;
	trace?: Trace;
	/** Model calls this job may still spend on reviews; shared across the job's reviews. */
	budget?: ReviewBudget;
}

/** A per-job cap on review model calls. Exhausting it never blocks: the deterministic checks still run. */
export class ReviewBudget {
	constructor(public remaining = 4) {}
	take(): boolean {
		if (this.remaining <= 0) return false;
		this.remaining--;
		return true;
	}
}

const MAX_CONTEXT = 6000;

export async function review<I, O, F>(
	cp: Checkpoint<I, O, F>,
	c: ReviewCase<I, O, F>,
	deps: ReviewDeps = {}
): Promise<Verdict> {
	const t0 = performance.now();
	const findings = cp.check(c);
	let verdict: Verdict;
	let scored: { value: number; source: string; model?: string } | null = null;
	const block = findings.filter((f) => f.severity === 'block');
	const revise = findings.filter((f) => f.severity === 'revise');
	if (block.length) verdict = { kind: 'block', reason: block.map((f) => f.message).join(' ') };
	else if (revise.length)
		verdict = { kind: 'revise', feedback: revise.map((f) => f.message).join(' ') };
	else if (cp.score && deps.decide && (deps.budget ?? new ReviewBudget()).take()) {
		const d = await deps.decide.score({
			question: cp.score.question,
			rubric: cp.rubric,
			context: cp.score.context(c).slice(0, MAX_CONTEXT),
			max: cp.score.max
		});
		scored = { value: d.value, source: d.source, model: d.model };
		verdict =
			d.source !== 'rules' && d.value < cp.score.pass
				? {
						kind: 'revise',
						feedback: `Rubric score ${d.value}/${cp.score.max} (pass ${cp.score.pass}). Rewrite to meet: ${cp.rubric}`
					}
				: { kind: 'pass', ...(d.source === 'rules' ? { notes: ['not scored offline'] } : {}) };
	} else verdict = { kind: 'pass' };

	deps.trace?.('decision', {
		kind: 'review',
		job: `review.${cp.id}`,
		checkpoint: cp.id,
		verdict: verdict.kind,
		findings: findings.map((f) => f.message),
		...(scored ? { score: scored.value, source: scored.source, model: scored.model } : {}),
		latencyMs: Math.round(performance.now() - t0)
	});
	return verdict;
}

/**
 * Produce → review → on revise, one retry of the producer with the feedback → review again. A second revise
 * keeps the retried output and reports the verdict; block stops with the reason. Never more than two
 * productions per call.
 */
export async function withReview<I, O, F>(
	cp: Checkpoint<I, O, F>,
	o: {
		input: I;
		facts: F;
		produce: (feedback?: string) => Promise<O> | O;
	},
	deps: ReviewDeps = {}
): Promise<{ output: O; verdict: Verdict; attempts: number }> {
	let output = await o.produce();
	let verdict = await review(cp, { input: o.input, output, facts: o.facts }, deps);
	if (verdict.kind !== 'revise') return { output, verdict, attempts: 1 };
	output = await o.produce(verdict.feedback);
	verdict = await review(cp, { input: o.input, output, facts: o.facts }, deps);
	return { output, verdict, attempts: 2 };
}

/** The review flag: off unless `REVIEW=1` (shipped dark until the evals show it helps). */
export function reviewEnabled(env: Record<string, string | undefined>): boolean {
	return env.REVIEW === '1';
}

export { outcomeTextCheckpoint, type OutcomeFacts } from './outcome';
export { requestParseCheckpoint } from './parse';
