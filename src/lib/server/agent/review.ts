import type { Llm } from '$lib/core/ports';
import {
	outcomeTextCheckpoint,
	ReviewBudget,
	withReview,
	type OutcomeFacts,
	type ReviewDeps
} from '$lib/server/review';
import type { StepRecord } from './loop';
import type { GoalOutcome } from './types';

/** What the run's steps say about commits, receipts and approvals, for the outcome-text review. */
export function outcomeFacts(outcome: GoalOutcome, steps: StepRecord[]): OutcomeFacts {
	let committedLines = 0;
	let awaiting = 0;
	let approvalsGranted = 0;
	for (const s of steps) {
		if (!s.ok) continue;
		const v = (s.value ?? {}) as {
			committedLineIds?: unknown[];
			awaitingSupplier?: unknown[];
			approval?: { state?: string } | null;
		};
		if (s.tool === 'commit_order') {
			committedLines += v.committedLineIds?.length ?? 0;
			awaiting += v.awaitingSupplier?.length ?? 0;
		}
		if (s.tool === 'get_plan' && v.approval?.state === 'granted') approvalsGranted = 1;
	}
	return {
		status: outcome.status,
		unresolvedNeeds: outcome.unresolvedNeeds.length,
		committedLines,
		approvalsGranted,
		supplierConfirmedLines: Math.max(0, committedLines - awaiting)
	};
}

/**
 * The planner's summary, reviewed: kept when it passes; on revise, rewritten once by the model with the
 * critique (or replaced by the outcome's own domain text when there is no model or the rewrite still fails);
 * on block, withheld with the reason. The outcome itself is never touched.
 */
export function outcomeReviewer(o: {
	goal: string;
	deps: ReviewDeps;
	llm?: Llm;
	signal?: AbortSignal;
}) {
	const budget = o.deps.budget ?? new ReviewBudget();
	return async (r: { summary: string; outcome: GoalOutcome; steps: StepRecord[] }) => {
		const facts = outcomeFacts(r.outcome, r.steps);
		const res = await withReview(
			outcomeTextCheckpoint,
			{
				input: { goal: o.goal },
				facts,
				produce: async (feedback) => {
					if (!feedback) return r.summary;
					if (!o.llm || !budget.take()) return r.outcome.nextAction;
					const g = await o.llm.generate({
						system:
							'Rewrite a purchasing agent run summary so it claims exactly what the facts support. One or two sentences, plain text.',
						prompt: JSON.stringify({ summary: r.summary, critique: feedback, facts }),
						maxTokens: 200,
						signal: o.signal
					});
					return g.text.trim().slice(0, 600);
				}
			},
			{ ...o.deps, budget }
		);
		if (res.verdict.kind === 'pass') return res.output;
		if (res.verdict.kind === 'block') return `(summary withheld: ${res.verdict.reason})`;
		return r.outcome.nextAction;
	};
}
