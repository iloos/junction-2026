/**
 * "Describe your kitchen" (D15): the nearest seeded kitchen for a chef's description. Live, Flash-Lite answers
 * through the LLM router's `establishment.match` job (traced, capped per visitor); its answer counts only if it
 * names a seeded kitchen with a reason, otherwise the rules in core/establishment.ts decide. The description is
 * returned as notes and changes no rule.
 */
import type { Kitchen } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import {
	matchByRules,
	matchPrompt,
	readModelMatch,
	type EstablishmentMatch
} from '$lib/core/establishment';

/** Longest description accepted; the notes keep at most 500 characters of it. */
export const MAX_DESCRIPTION = 2000;

export async function matchEstablishment(
	text: string,
	kitchens: readonly Kitchen[],
	llm?: Llm | null,
	signal?: AbortSignal
): Promise<EstablishmentMatch & { rejected?: string }> {
	if (!llm) return matchByRules(text, kitchens);
	try {
		const { system, prompt } = matchPrompt(text, kitchens);
		const res = await llm.generate({ system, prompt, maxTokens: 300, json: true, signal });
		if (res.model === 'fixture') return matchByRules(text, kitchens);
		const read = readModelMatch(res.text, text, kitchens);
		return (
			read ?? { ...matchByRules(text, kitchens), rejected: 'model answer not a seeded kitchen' }
		);
	} catch (e) {
		return {
			...matchByRules(text, kitchens),
			rejected: String((e as Error)?.message ?? e).slice(0, 120)
		};
	}
}
