/**
 * The two golden briefs every proposal path is judged on, built the way /request builds them: the words, then the
 * chef's answers to the brief questions. Used by the rubric tests and the live (opt-in) model test.
 */
import type { EventBrief } from '$lib/core/contracts';
import type { BriefAnswer } from '$lib/ui/request/types';
import { applyBriefAnswers, draftBrief, toEventBrief } from './brief';

export const GOLDEN_TODAY = '2026-12-07';

export const GOLDEN: { name: string; text: string; answers: BriefAnswer[] }[] = [
	{
		name: 'five-star',
		text: '5-star 5-course dinner for 50',
		answers: [
			{ id: 'brief.date', value: '2026-12-18' },
			{ id: 'brief.dietary', value: ['lactose-free', 'vegetarian:6'] },
			{ id: 'brief.budget', value: 0 }
		]
	},
	{
		name: 'christmas',
		text: 'Christmas dinner for 50 on 20 December',
		answers: [
			{ id: 'brief.serviceStyle', value: 'buffet' },
			{ id: 'brief.dietary', value: ['lactose-free'] },
			{ id: 'brief.budget', value: 2000 }
		]
	}
];

export function goldenBrief(name: string): EventBrief {
	const g = GOLDEN.find((x) => x.name === name)!;
	const b = toEventBrief(
		applyBriefAnswers(draftBrief(g.text, GOLDEN_TODAY), g.answers, GOLDEN_TODAY),
		g.text
	);
	if (!b) throw new Error(`golden brief ${name} is incomplete`);
	return b;
}
