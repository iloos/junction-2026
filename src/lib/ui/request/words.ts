/** Plain-word reasons for a request's order lines, with the kitchen's own numbers. */
import type { Line } from '$lib/core/contracts';
import { money, num } from '$lib/ui/format';
import { reasonLong, reasonShort } from '$lib/ui/reasons';

export interface Caps {
	lineCapCents: number;
	orderCapCents: number;
	weeklyCapCents: number;
	hardLimitCents?: number;
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
		case 'over_hard_limit': {
			// Unorderable lines carry no line total; the attempted amount is quantity × quoted price.
			const unit = line.offer?.price?.unitCents;
			const tried = unit === undefined ? null : Math.round(unit * line.qty.value);
			return `${tried === null ? 'This' : money(tried, { whole: true })} is over this kitchen's ${caps.hardLimitCents ? w(caps.hardLimitCents) + ' ' : ''}hard limit: no approval can pass it. Raise the mandate first`;
		}
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

/** Valio sales-unit codes in words: (singular, plural). Unknown codes stay as written. */
const SALES_UNIT: Record<string, [string, string]> = {
	ST: ['pack', 'packs'],
	KPL: ['piece', 'pieces'],
	PCE: ['piece', 'pieces'],
	KI: ['case', 'cases'],
	LTK: ['case', 'cases'],
	PS: ['bag', 'bags'],
	PSS: ['bag', 'bags'],
	BAG: ['bag', 'bags'],
	PKT: ['packet', 'packets'],
	PAK: ['pack', 'packs'],
	PRK: ['tub', 'tubs'],
	RAS: ['tin', 'tins'],
	SKI: ['crate', 'crates'],
	LAV: ['pallet', 'pallets']
};

/** "1 pack" / "1,000 packs"; KG stays "20 kg". */
export function salesUnitWords(qty: number, unit: string): string {
	if (unit === 'KG') return `${num(qty, 3)} kg`;
	const w = SALES_UNIT[unit.toUpperCase()];
	return `${num(qty, 3)} ${w ? (qty === 1 ? w[0] : w[1]) : unit}`;
}

/** A physical amount, small ones in g or dl: 0.5 kg → "500 g". */
export function measureWords(value: number, unit: string): string {
	if (unit === 'kg' && value < 1) return `${num(value * 1000, 3)} g`;
	if (unit === 'l' && value < 1) return `${num(value * 10, 3)} dl`;
	return `${num(value, 3)} ${unit}`;
}

/**
 * A sales quantity in words with what one unit holds, when known: "1,000 packs of 1 l", "4 cases of 5 kg",
 * "20 kg". `physical` is the whole line's physical amount (LineView.physical).
 */
export function quantityWords(
	qty: number,
	unit: string,
	physical?: { value: number; unit: string } | null
): string {
	const base = salesUnitWords(qty, unit);
	if (unit === 'KG' || !physical || qty <= 0) return base;
	return `${base} of ${measureWords(physical.value / qty, physical.unit)}`;
}

/** One sales unit in words, for prices: "pack", "case", "kg". */
export function unitWord(unit: string): string {
	return salesUnitWords(1, unit).replace(/^1 /, '');
}

/** An approval's state as the chef reads it. */
export const APPROVAL_STATE_WORDS: Record<string, string> = {
	pending: 'Waiting for approval',
	granted: 'Approved',
	denied: 'Denied',
	invalidated: 'Voided by a change',
	expired: 'Expired'
};
