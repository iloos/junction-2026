/**
 * Why a line can't be ordered, from its typed reasons, and who imposed it: Valio (stock, delivery, a sales
 * block), the kitchen's own rules (a hard requirement, an excluded allergen, a limit) or the order itself (a fact
 * gap, a passed cut-off). Ops and Orders read this, so a kitchen rule is never shown as supplier stock.
 */
import type { Line } from '../contracts';

export type CauseBy = 'valio' | 'kitchen' | 'order';

export interface Cause {
	by: CauseBy;
	/** The reason it rests on (a LineReason). */
	reason: string;
	/** Short, after the product name: "is out of stock at Valio". */
	text: string;
	/** True when the product itself is missing (out, undeliverable, blocked, short): a shortage, not a rule. */
	shortage: boolean;
}

const VALIO: Record<string, Omit<Cause, 'reason' | 'by'>> = {
	out: { text: 'is out of stock at Valio', shortage: true },
	undeliverable: { text: "can't be delivered in time, Valio says", shortage: true },
	blocked: { text: 'is blocked from sale by Valio', shortage: true },
	INSUFFICIENT_STOCK: { text: "isn't in stock in the amount needed at Valio", shortage: true },
	BELOW_LOT: { text: "is below Valio's smallest lot", shortage: false }
};

const KITCHEN: Record<string, string> = {
	requirement_unmet: "doesn't meet a hard requirement of the kitchen",
	allergen_declared: 'declares an allergen the kitchen excludes',
	origin_required: "doesn't meet the kitchen's origin rule",
	over_hard_limit: "is above the kitchen's hard limit",
	CAP_EXCEEDED: "would go over the kitchen's spending cap",
	off_tender_list: "isn't on the kitchen's tender list",
	FORBIDDEN: "isn't allowed by the kitchen's mandate"
};

const ORDER: Record<string, string> = {
	price_missing: 'has no price yet, so it can’t be ordered',
	unit_mismatch: "is asked for in a unit Valio doesn't sell it in",
	qty_implausible: 'has a quantity that needs checking',
	cutoff_passed: "missed Valio's order cut-off",
	recall: 'is named in a recall notice',
	UNKNOWN_REQUIRED: 'is missing a fact the order needs'
};

/** The cause behind a line's reasons; the first reason that names one wins (Valio, then the kitchen, then the order). */
export function causeOf(l: Pick<Line, 'reasons'>): Cause {
	const reasons = l.reasons.map(String);
	const base = (r: string) => r.split('.')[0];
	for (const r of reasons) {
		const v = VALIO[r] ?? VALIO[base(r)];
		if (v) return { by: 'valio', reason: r, ...v };
	}
	for (const r of reasons) {
		const k = KITCHEN[r] ?? KITCHEN[base(r)];
		if (k) return { by: 'kitchen', reason: r, text: k, shortage: false };
	}
	for (const r of reasons) {
		const o = ORDER[r] ?? ORDER[base(r)];
		if (o) return { by: 'order', reason: r, text: o, shortage: false };
	}
	const r = reasons[0] ?? '';
	return {
		by: 'order',
		reason: r,
		text: r ? `can't be ordered (${r.replaceAll('_', ' ').toLowerCase()})` : "can't be ordered",
		shortage: false
	};
}
