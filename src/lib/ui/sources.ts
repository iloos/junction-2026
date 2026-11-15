import type { Source } from '$lib/core/contracts';
import { humanDates } from './format';

/**
 * How a provenance source reads on screen. Four families the pitch promises the judge:
 * Valio data (live or cached), our simulator/scenario, team estimates, and the chef's own input.
 */
export type SourceFamily = 'valio' | 'scenario' | 'estimate' | 'chef' | 'rule';

export const SOURCE_LABEL: Record<Source | 'mandate', { label: string; family: SourceFamily }> = {
	valio_live: { label: 'Valio Aimo live', family: 'valio' },
	valio_cache: { label: 'Valio Aimo cached', family: 'valio' },
	valio_static: { label: 'Valio Aimo catalogue', family: 'valio' },
	simulator: { label: 'Simulated', family: 'scenario' },
	seed: { label: 'Scenario', family: 'scenario' },
	parsed: { label: 'Parsed', family: 'estimate' },
	category_estimate: { label: 'Category estimate', family: 'estimate' },
	team_estimate: { label: 'Team estimate', family: 'estimate' },
	llm: { label: 'Model estimate', family: 'estimate' },
	web: { label: 'Web source', family: 'estimate' },
	user: { label: 'Chef', family: 'chef' },
	mandate: { label: 'Your mandate', family: 'rule' }
};

/**
 * A source's chip. A free-text provenance note in place of a source code (the scenario's date shift: "scenario
 * dates: D-1 cut-off…") is labelled by its kind, with the note kept as the chip's title; anything else unknown shows
 * as a short label, never as a raw sentence with ISO dates in it.
 */
export function sourceLabel(source: string): {
	label: string;
	family: SourceFamily;
	note?: string;
} {
	const known = SOURCE_LABEL[source as Source];
	if (known) return known;
	if (/^scenario dates\b/i.test(source))
		return { label: 'Scenario dates', family: 'scenario', note: humanDates(source) };
	if (source.length > 24 || /\d{4}-\d\d-\d\d/.test(source))
		return { label: 'Note', family: 'estimate', note: humanDates(source) };
	return { label: source, family: 'estimate' };
}
