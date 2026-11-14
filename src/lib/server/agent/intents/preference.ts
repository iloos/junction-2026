/**
 * A ranking preference in the chef's words, English or Finnish, for one request: "cheapest", "lowest carbon",
 * "prefer Finnish", "most reliable". Read deterministically; it becomes `rankBy` for that request's searches,
 * substitutes and routine choice. It never sets a requirement: "must be Finnish" still prefers Finnish, and says that
 * requiring an origin is the chef's mandate rule (Kitchen screen).
 */
import type { RankBy } from '$lib/core/contracts';

const PATTERNS: [Exclude<RankBy, 'kitchen'>, RegExp][] = [
	[
		'price',
		/\b(cheapest|cheaper|lowest[- ]price\w*|least expensive|best price|on a budget|budget option|halvin\w*|halvemp\w*|edullisin\w*|edullisemp\w*)\b/i
	],
	[
		'carbon',
		/\b(lowest[- ](carbon|co2|co₂|emissions?|footprint)|low[- ](carbon|co2|co₂|emissions?)|least (carbon|co2|co₂|emissions?)|greenest|climate[- ]friendly|smallest footprint|vähähiilisin\w*|vähäpäästöisin\w*|ilmastoystävällisin\w*|pienin hiilijalanjälki)\b/i
	],
	[
		'finnish',
		/\b(prefer(ably|ring)? (finnish|domestic)|(finnish|domestic) if (possible|available)|(finnish|domestic) where possible|mieluiten (kotimai\w*|suomalai\w*)|(kotimai\w*|suomalai\w*) jos mahdollista|must be (finnish|domestic)|only (finnish|domestic))\b/i
	],
	[
		'reliability',
		/\b(most reliable|reliable (supply|delivery|supplier)|safest delivery|on[- ]time|luotettavin\w*|varmin\w*|toimitusvarm\w*)\b/i
	]
];

/** "must be Finnish", "only domestic": a requirement the chef sets in the mandate, never from chat. */
const REQUIRES_ORIGIN =
	/\b(must be (finnish|domestic)|only (finnish|domestic)|pakko olla (kotimai\w*|suomalai\w*))\b/i;

export interface Preference {
	rankBy: Exclude<RankBy, 'kitchen'>;
	/** The words that said it, for "Ranked by … (you said "cheapest")". */
	said: string;
	/** The words asked for an origin requirement, which chat does not set. */
	requirementAsked: boolean;
}

/** The first preference the words state, or null. One per request: the first named wins. */
export function readPreference(text: string): Preference | null {
	let best: { rankBy: Exclude<RankBy, 'kitchen'>; at: number; said: string } | null = null;
	for (const [rankBy, re] of PATTERNS) {
		const m = re.exec(text);
		if (m && (best === null || m.index < best.at)) best = { rankBy, at: m.index, said: m[0] };
	}
	return best
		? { rankBy: best.rankBy, said: best.said, requirementAsked: REQUIRES_ORIGIN.test(text) }
		: null;
}

/**
 * What the preference did, for the answer: each "Picked X over Y: …" the routine choice recorded, else that the
 * ranking used it. Requiring an origin is said to be the chef's rule.
 */
export function preferenceSentence(
	p: Preference,
	steps: readonly { tool: string; ok: boolean; why: string }[],
	names: Record<Exclude<RankBy, 'kitchen'>, string>
): string {
	const picked = steps
		.filter((s) => s.tool === 'place_order' && s.ok)
		.flatMap(
			(s) => s.why.match(/; preference: (.*?)(?:; not ordered: .*)?$/s)?.[1]?.split('; ') ?? []
		);
	const ranked = steps.some((s) => s.tool === 'find_substitutes' || s.tool === 'search_products');
	const out = picked.length
		? `${picked.join('. ')}.`
		: ranked
			? `Ranked by ${names[p.rankBy]} for this request (you said “${p.said}”); it never changes what the mandate allows.`
			: '';
	const rule = p.requirementAsked
		? ' Requiring an origin is the chef’s mandate rule, set in the Kitchen screen; for this request I preferred it.'
		: '';
	return (out + rule).trim();
}
