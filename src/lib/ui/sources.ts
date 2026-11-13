import type { Source } from '$lib/core/contracts';

/**
 * How a provenance source reads on screen. Four families the pitch promises the judge:
 * Valio data (live or cached), our simulator/scenario, team estimates, and the chef's own input.
 */
export type SourceFamily = 'valio' | 'scenario' | 'estimate' | 'chef' | 'rule';

export const SOURCE_LABEL: Record<Source | 'mandate', { label: string; family: SourceFamily }> = {
	valio_live: { label: 'Valio live', family: 'valio' },
	valio_cache: { label: 'Valio cached', family: 'valio' },
	valio_static: { label: 'Valio catalogue', family: 'valio' },
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

export function sourceLabel(source: string): { label: string; family: SourceFamily } {
	return SOURCE_LABEL[source as Source] ?? { label: source, family: 'estimate' };
}
