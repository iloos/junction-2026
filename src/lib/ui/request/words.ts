/** Plain-word reasons for a request's order lines, with the kitchen's own numbers. */
import type { Line } from '$lib/core/contracts';
import { money } from '$lib/ui/format';
import { reasonLong, reasonShort } from '$lib/ui/reasons';

export interface Caps {
	lineCapCents: number;
	orderCapCents: number;
	weeklyCapCents: number;
}

export function reasonWords(
	code: string,
	line: Line,
	planTotal: number | null,
	caps: Caps
): string {
	const w = (c: number) => money(c, { whole: true });
	switch (code) {
		case 'CAP_EXCEEDED.line':
			return `${money(line.lineCents)} line is over your ${w(caps.lineCapCents)} line limit`;
		case 'CAP_EXCEEDED.order':
			return `${money(planTotal)} order is over your ${w(caps.orderCapCents)} order limit`;
		case 'CAP_EXCEEDED.weekly':
			return `this order takes the week over your ${w(caps.weeklyCapCents)} weekly limit`;
		case 'new_sku':
			return "a product this kitchen hasn't bought before: your mandate says ask first";
		default:
			return reasonLong(code) === code ? reasonShort(code) : reasonLong(code);
	}
}

export const TIER_WORDS = {
	act: { title: 'Within your mandate', body: 'The agent may commit this alone.' },
	propose: { title: 'Proposed', body: 'Needs one tap from the chef.' },
	sign_off: { title: 'Sign-off', body: 'Over the limits you set: needs the named approver.' }
} as const;

export const UNIT_WORDS: Record<string, string> = {
	l: 'l',
	kg: 'kg',
	pcs: 'pcs',
	case: 'cases',
	sales: '× sales unit'
};

export const CONSTRAINT_WORDS: Record<string, string> = {
	lactose_free: 'lactose-free',
	organic: 'organic',
	finnish: 'Finnish',
	gluten_free: 'gluten-free'
};

/** "valio_cache" → "Valio cached" etc. for the lookup step's quote source. */
export function offerSourceWords(sources: string[]): string {
	const map: Record<string, string> = {
		valio_live: 'Valio live',
		valio_cache: 'Valio cached',
		simulator: 'simulator overlay'
	};
	return sources.map((s) => map[s] ?? s).join(' + ') || 'no offers';
}
