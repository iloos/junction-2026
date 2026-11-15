/**
 * D28 in chat: the chef steers a line's product in words. "something cheaper", "a Finnish one", "organic please",
 * "bigger pack", "same brand", "if no ham then salmon" become one find_substitutes call with the same steer the page's
 * chips send, applied (the chef asked for it). A chef's pick of another kind is labelled "your choice"; hard rules
 * still refuse. The reply names the pick and up to three alternatives, each with its total for the need.
 */
import type { Line, ToolOutput } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { readableName } from '$lib/ui/format';
import { namedLines } from './decide';

export interface SteerWords {
	rankBy?: 'price' | 'carbon';
	requireOrigin?: 'fi';
	steer?: {
		organic?: boolean;
		pack?: 'bigger' | 'smaller';
		sameBrand?: boolean;
		differentKind?: boolean;
		text?: string;
	};
	/** The line the words name ("a cheaper butter"), when they name one. */
	target?: string;
	/** "if no ham then salmon": only when the named line can't be ordered. */
	onlyIf?: string;
}

const CHEAPER = /\b(cheaper|cheapest|less expensive|lower price|halvempi|halvin|edullisempi)\b/i;
const GREENER = /\b(lower carbon|less co2|greener|ilmasto\p{L}*)\b/iu;
const FINNISH = /\b(finnish|suomalai\p{L}*|kotimai\p{L}*|from finland)\b/iu;
const ORGANIC = /\b(organic|luomu\p{L}*)\b/iu;
const BIGGER = /\b(bigger|larger|big(?:ger)? pack|isompi|suurempi)\b/i;
const SMALLER = /\b(smaller|small(?:er)? pack|pienempi)\b/i;
const SAME_BRAND = /\b(same brand|sama merkki)\b/i;
const IF_NO = /^\s*if (?:there(?:'s| is) )?no\s+(.+?)[,]?\s+then\s+(.+?)\s*[.!]*$/i;
const INSTEAD =
	/^\s*(?:use|swap (?:it )?(?:to|for)|switch to|change (?:it )?to|vaihda)\s+(.+?)(?:\s+instead)?\s*[.!]*$/i;
/** The words a steer is about: "a cheaper one", "cheaper butter please" → "butter". */
const FILLER =
	/\b(something|a|an|the|one|ones|please|pls|instead|cheaper|cheapest|finnish|organic|bigger|larger|smaller|pack|packs|same|brand|lower|carbon|greener|get|find|show|me|i|want|need|of|it|that|this)\b/gi;

/** The steer the chef's words ask for, or null when they are not one. */
export function steerWords(text: string): SteerWords | null {
	const t = text.trim();
	const ifNo = t.match(IF_NO);
	if (ifNo)
		return { steer: { text: ifNo[2], differentKind: true }, onlyIf: ifNo[1], target: ifNo[1] };
	const instead = t.match(INSTEAD);
	if (instead) return { steer: { text: instead[1], differentKind: true } };
	const out: SteerWords = {};
	const steer: NonNullable<SteerWords['steer']> = {};
	if (CHEAPER.test(t)) out.rankBy = 'price';
	else if (GREENER.test(t)) out.rankBy = 'carbon';
	if (FINNISH.test(t)) out.requireOrigin = 'fi';
	if (ORGANIC.test(t)) steer.organic = true;
	if (BIGGER.test(t)) steer.pack = 'bigger';
	else if (SMALLER.test(t)) steer.pack = 'smaller';
	if (SAME_BRAND.test(t)) steer.sameBrand = true;
	if (Object.keys(steer).length) out.steer = steer;
	if (!out.rankBy && !out.requireOrigin && !out.steer) return null;
	// A steer is a short ask about a product, never an order with an amount ("10 kg cheaper butter" is an order).
	if (/\d/.test(t) || t.split(/\s+/).length > 8) return null;
	const rest = t
		.replace(FILLER, ' ')
		.replace(/[^\p{L}\s-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (rest) out.target = rest;
	return out;
}

const euro = (c?: number) => (c === undefined ? '' : ` · €${(c / 100).toFixed(2)}`);

/** Steers one line of the plan as the chef and says what it picked, in short lines. */
export async function steerLine(
	words: SteerWords,
	planId: string | null,
	chef: CallContext,
	handlers: ToolHandlers
): Promise<{ text: string; changed: boolean }> {
	if (!planId)
		return {
			text: 'Which order do you mean? Order something first, then ask for a cheaper or Finnish one.',
			changed: false
		};
	const r = await handlers.get_plan(chef, { planId });
	if (!r.ok) return { text: "I can't see that order from here.", changed: false };
	const { plan } = r.value as ToolOutput<'get_plan'>;
	const lines = plan.lines.filter((l) => l.qty.value > 0 && l.state !== 'committed');
	const labels = new Map(
		lines.map((l) => [l.id, plan.needs.find((n) => n.id === l.needId)?.label ?? ''])
	);
	const named = words.target ? namedLines(words.target, lines, labels) : [];
	const line: Line | undefined = named[0] ?? (lines.length === 1 ? lines[0] : undefined);
	if (!line)
		return {
			text: `Which line? ${lines
				.slice(0, 4)
				.map((l) => readableName(l.productName ?? l.productId))
				.join(', ')}.`,
			changed: false
		};
	const was = readableName(line.productName ?? line.productId);
	if (words.onlyIf && line.state !== 'unorderable')
		return {
			text: `${was} can be ordered, so it stays. I'll switch to ${words.steer?.text} only if it can't.`,
			changed: false
		};
	const s = await handlers.find_substitutes(chef, {
		planId,
		version: plan.version,
		lineId: line.id,
		...(words.rankBy ? { rankBy: words.rankBy } : {}),
		...(words.requireOrigin ? { requireOrigin: words.requireOrigin } : {}),
		...(words.steer ? { steer: words.steer } : {}),
		apply: true
	});
	if (!s.ok) return { text: `Not changed: ${s.error.message}`, changed: false };
	const v = s.value as ToolOutput<'find_substitutes'>;
	if (!v.pick)
		return {
			text: `Nothing fits that for ${was}${v.fallback ? `: ${v.fallback}` : ''}. It stays as it is.`,
			changed: false
		};
	const name = readableName(v.pick.productName ?? v.pick.productId);
	const mine = words.steer?.differentKind ? ' (your choice)' : '';
	const alts = (v.alternatives ?? [])
		.slice(0, 3)
		.map(
			(a) => `• ${readableName(a.productName ?? a.productId)}${euro(a.totalCents)}: ${a.reason}`
		);
	return {
		text: [
			v.applied
				? `Switched ${was} to ${name}${mine}${euro(v.pick.totalCents)}.`
				: `${name}${mine}${euro(v.pick.totalCents)} is the best fit; ${was} stays.`,
			v.fallback ?? '',
			alts.length ? 'Other options:' : '',
			...alts,
			v.applied ? 'The change waits for your approval before it is ordered.' : ''
		]
			.filter(Boolean)
			.join('\n'),
		changed: v.applied
	};
}
