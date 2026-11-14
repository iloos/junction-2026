import type { FulfilmentView } from '$lib/core/contracts';
import type { Checkpoint, Finding } from './index';

/**
 * Checkpoint: the agent's outcome text (the run summary a chef or a client reads). It may claim nothing stronger
 * than the domain state supports (D10): "supplier confirmed" needs receipt-backed quantity, "fulfilled" needs
 * the outcome status, "approved" needs a granted approval, "ordered" needs a committed line, and unresolved
 * demand must be named. The agent claiming an authority action it can't take is blocked.
 */
export interface OutcomeFacts {
	status: string;
	unresolvedNeeds: number;
	committedLines: number;
	approvalsGranted: number;
	/** Receipt-backed lines (commit receipts not awaiting the supplier). */
	supplierConfirmedLines: number;
	/** Per-need partition when the plan view carries it. */
	fulfilment?: FulfilmentView[];
}

const has = (text: string, re: RegExp) => re.test(text);
/** A word not negated just before it ("not approved", "unconfirmed"). */
const affirmed = (text: string, re: RegExp) => {
	const g = new RegExp(re.source, 'gi');
	for (const m of text.matchAll(g)) {
		const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
		if (!/\b(not|no|never|un|awaiting|needs?|until|before)\s*$/.test(before)) return true;
	}
	return false;
};

export const outcomeTextCheckpoint: Checkpoint<{ goal: string }, string, OutcomeFacts> = {
	id: 'agent.outcome_text',
	rubric:
		'Says what was done and what remains, in the same terms as the plan state: supplier confirmed only for receipt-backed lines; ordered for committed lines; held lines wait for a chef; every unresolved need is named; never claims an approval or a mandate change the agent cannot make.',
	check({ output, facts }): Finding[] {
		const t = output.toLowerCase();
		const out: Finding[] = [];
		if (
			has(t, /\bi (have |just )?(approved|granted|raised|lifted|changed the (cap|mandate|limit))/)
		)
			out.push({
				severity: 'block',
				message:
					'The text says the agent approved or changed the mandate; it cannot. Report what is held for the chef instead.'
			});
		const confirmed =
			facts.supplierConfirmedLines > 0 ||
			(facts.fulfilment ?? []).some((f) => f.supplierConfirmed.value > 0);
		if (!confirmed && affirmed(t, /(supplier[- ]confirmed|confirmed by (the )?supplier|delivered)/))
			out.push({
				severity: 'revise',
				message:
					'Nothing is supplier confirmed (no receipt-backed quantity): say "planned" or "ordered, awaiting supplier".'
			});
		if (
			facts.status !== 'fulfilled' &&
			affirmed(
				t,
				/(fulfilled|fully (ordered|covered|planned)|all done|everything (is )?(ordered|covered))/
			)
		)
			out.push({
				severity: 'revise',
				message: `The outcome is ${facts.status}, not fulfilled: say what is still open.`
			});
		if (facts.approvalsGranted === 0 && affirmed(t, /\b(approved|granted)\b/))
			out.push({
				severity: 'revise',
				message: 'No approval was granted: say the held lines wait for a chef.'
			});
		if (facts.committedLines === 0 && affirmed(t, /\b(ordered|committed|placed the order)\b/))
			out.push({
				severity: 'revise',
				message: 'Nothing was committed: say "planned" or "held", not "ordered".'
			});
		if (
			facts.unresolvedNeeds > 0 &&
			!has(
				t,
				/(unresolved|missing|not covered|uncovered|short|unorderable|no substitute|still open)/
			)
		)
			out.push({
				severity: 'revise',
				message: `${facts.unresolvedNeeds} need(s) are unresolved: name them as still open.`
			});
		return out;
	},
	score: {
		question:
			'Does the summary claim exactly what the facts support, no more (supplier confirmed, ordered, approved, fulfilled), and name what is still open?',
		max: 4,
		pass: 3,
		context: ({ input, output, facts }) =>
			JSON.stringify({ goal: input.goal, summary: output, facts })
	}
};
