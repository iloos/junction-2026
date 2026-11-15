/**
 * Why the agent picked a replacement, in at most three short words, from what the candidate already carries: its
 * supply, its origin and its strongest score component ("in stock · Finnish · best €/kg"). The full comparison stays
 * behind Why and Swap.
 */
import type { ScoreBreakdown } from '$lib/core/contracts';

const COMPONENT: Record<string, string> = {
	price: 'best €/kg',
	reliability: 'reliable supply',
	carbon: 'low carbon',
	organic: 'organic',
	finnish: 'Finnish'
};

export function pickedWords(c: {
	kind?: string;
	origin?: string;
	score?: ScoreBreakdown;
}): string | null {
	const words: string[] = [];
	if (c.kind === 'known') words.push('in stock');
	if (c.origin?.toUpperCase() === 'FI') words.push('Finnish');
	const top = Object.entries(c.score?.components ?? {})
		.filter(([, v]) => v.weight > 0 && v.utility >= 0.6)
		.sort(([, a], [, b]) => b.utility * b.weight - a.utility * a.weight)
		.map(([k]) => COMPONENT[k])
		.find((w) => w && !words.includes(w));
	if (top) words.push(top);
	return words.length ? words.slice(0, 3).join(' · ') : null;
}
