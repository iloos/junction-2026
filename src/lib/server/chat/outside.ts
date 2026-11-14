/**
 * After a shortage repair, the needs still unresolved get options from outside the Valio catalogue (find_outside):
 * for the chef's information only. They are never ordered, never added to a plan, and labelled so. Read scope only,
 * through the gate; at most two needs and three options each, so one repair spends at most two web lookups.
 */
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import type { NeedRef } from '$lib/server/agent/types';
import { hostOf, type Source } from '$lib/server/agent/intents/questions';
import { serveTool } from '$lib/server/tools/serve';
import type { ChatEvent } from '$lib/ui/chat/types';

const MAX_NEEDS = 2;
const MAX_OPTIONS = 3;

export const OUTSIDE_LABEL = 'For your information; not orderable here';

export interface OutsideOptions {
	steps: { summary: string; ok: boolean }[];
	/** One sentence for the answer, or '' when nothing was found. */
	text: string;
	sources: Source[];
}

export async function outsideOptions(
	needs: NeedRef[],
	ctx: CallContext,
	handlers: ToolHandlers
): Promise<OutsideOptions | null> {
	if (!needs.length) return null;
	const steps: OutsideOptions['steps'] = [];
	const found: string[] = [];
	const sources: Source[] = [];
	for (const need of needs.slice(0, MAX_NEEDS)) {
		const r = await serveTool('find_outside', ctx, { need: need.label }, handlers);
		if (!r.ok) {
			steps.push({
				ok: false,
				summary: `Looked outside the catalogue for ${need.label}: ${r.error.message}`
			});
			continue;
		}
		const options = (r.value as { options: { title: string; url: string }[] }).options.slice(
			0,
			MAX_OPTIONS
		);
		steps.push({
			ok: true,
			summary: options.length
				? `Found ${options.length} option(s) outside the catalogue for ${need.label} (${OUTSIDE_LABEL.toLowerCase()}).`
				: `Found nothing outside the catalogue for ${need.label}.`
		});
		if (!options.length) continue;
		found.push(
			`${need.label}: ${options.map((o) => `${o.title}${hostOf(o.url) ? ` (${hostOf(o.url)})` : ''}`).join('; ')}`
		);
		for (const o of options)
			sources.push({
				url: o.url,
				title: o.title,
				...(hostOf(o.url) ? { host: hostOf(o.url) } : {})
			});
	}
	return {
		steps,
		text: found.length ? `${OUTSIDE_LABEL}: ${found.join(' · ')}.` : '',
		sources
	};
}

/** The repair's extra steps as chat lines, numbered after the run's own. */
export function outsideSteps(taskId: string, after: number, o: OutsideOptions): ChatEvent[] {
	return o.steps.map((s, i) => ({
		type: 'step',
		taskId,
		n: after + i + 1,
		tool: 'find_outside',
		ok: s.ok,
		summary: s.summary,
		source: 'live'
	}));
}
