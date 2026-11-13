/**
 * Mandate tiering (PRODUCT ★4, D6): every quoted line becomes eligible (act), held (propose | sign_off, with
 * reasons) or unorderable. Caps gate the act tier only; an external caller always needs a human approval.
 */
import type {
	ActorKind,
	Kitchen,
	Line,
	LineReason,
	Offer,
	PlanState,
	Product,
	SalesQty,
	Tier
} from '../contracts';
import type { TermsLine } from '../hash';

export interface DraftLine {
	id: string;
	needId?: string;
	productId: string;
	qty: SalesQty;
	provenance: Line['provenance'];
	substituteFor?: string;
	/** Reasons the caller adds (e.g. allergen_change for a make-in-house recipe). */
	extraReasons?: LineReason[];
}

/** Reasons a caller adds that the data can't recompute; they survive every re-quote. */
const STICKY: ReadonlySet<string> = new Set(['allergen_change', 'substitute_breaks_preference']);

/** A stored line back to a draft for re-quoting, keeping its sticky reasons. */
export function draftFromLine(l: Line): DraftLine {
	const extraReasons = l.reasons.filter((r) => STICKY.has(r));
	return {
		id: l.id,
		needId: l.needId,
		productId: l.productId,
		qty: l.qty,
		provenance: l.provenance,
		substituteFor: l.substituteFor,
		...(extraReasons.length ? { extraReasons } : {})
	};
}

export interface TierInput {
	kitchen: Kitchen;
	lines: DraftLine[];
	offers: Map<string, Offer>;
	products: Map<string, Product>;
	/** Committed spend in the delivery week, read from the locked budget row. */
	weekSpentCents: number;
	/** Who asks now, and who created the plan: either being external means approval is required. */
	actor: ActorKind;
	createdBy: ActorKind;
	/** Products this kitchen has committed before (for never-delegate `new_sku`). */
	orderedBefore: Set<string>;
	/** Lines already committed stay as they are and are not re-tiered. */
	committed?: Line[];
}

export interface TierResult {
	lines: Line[];
	planState: PlanState;
	totalCents: number;
	termsLines: TermsLine[];
	/** Held, orderable lines that need an approval, and the strictest tier among them. */
	held: { lineIds: string[]; tier: Tier } | null;
}

const RANK: Record<Tier, number> = { act: 0, propose: 1, sign_off: 2 };
const TIER_OF: Partial<Record<string, Tier>> = {
	UNKNOWN_REQUIRED: 'propose',
	INSUFFICIENT_STOCK: 'propose',
	new_sku: 'propose',
	low_reliability: 'propose',
	allergen_unknown: 'propose',
	substitute_breaks_preference: 'sign_off',
	off_tender_list: 'sign_off',
	origin_required: 'sign_off',
	external_agent_needs_approval: 'sign_off',
	allergen_change: 'sign_off'
};
const tierOf = (r: LineReason): Tier =>
	r.startsWith('CAP_EXCEEDED') ? 'sign_off' : (TIER_OF[r] ?? 'propose');
const maxTier = (rs: LineReason[]): Tier =>
	rs.map(tierOf).reduce<Tier>((a, b) => (RANK[b] > RANK[a] ? b : a), 'act');

export function tierLines(input: TierInput): TierResult {
	const { kitchen, offers, products } = input;
	const m = kitchen.mandate;
	const external = input.actor === 'external_agent' || input.createdBy === 'external_agent';
	type Work = {
		draft: DraftLine;
		offer: Offer | null;
		reasons: LineReason[];
		orderable: boolean;
		lineCents: number | null;
	};

	const work: Work[] = input.lines.map((draft) => {
		const offer = offers.get(draft.productId) ?? null;
		const product = products.get(draft.productId);
		const a = offer?.availability;
		const reasons: LineReason[] = [];
		if (!offer || !a)
			return { draft, offer, reasons: ['NOT_FOUND'], orderable: false, lineCents: null };
		if (a.kind === 'out' || a.kind === 'undeliverable' || a.kind === 'blocked')
			return { draft, offer, reasons: [a.kind], orderable: false, lineCents: null };
		if (a.kind === 'known' && a.amount !== null && a.amount < draft.qty.value) {
			if (a.amount < (product?.lotStep ?? 0.01))
				return { draft, offer, reasons: ['BELOW_LOT'], orderable: false, lineCents: null };
			reasons.push('INSUFFICIENT_STOCK');
		}
		if (a.kind === 'unknown') reasons.push('UNKNOWN_REQUIRED');
		const lineCents = offer.price ? Math.round(draft.qty.value * offer.price.unitCents) : null;
		if (lineCents === null) reasons.push('UNKNOWN_REQUIRED');
		if (m.neverDelegate.includes('new_sku') && !input.orderedBefore.has(draft.productId))
			reasons.push('new_sku');
		if (product?.reliability !== undefined && product.reliability < 0.7)
			reasons.push('low_reliability');
		if (
			kitchen.constraints.tenderListOnly &&
			!kitchen.constraints.tenderList?.includes(draft.productId)
		)
			reasons.push('off_tender_list');
		if (kitchen.constraints.allergens.freeFrom.length > 0 && product && !product.allergens.declared)
			reasons.push('allergen_unknown');
		if (lineCents !== null && lineCents > m.lineCapCents) reasons.push('CAP_EXCEEDED.line');
		reasons.push(...(draft.extraReasons ?? []));
		return { draft, offer, reasons, orderable: true, lineCents };
	});

	const orderable = work.filter((w) => w.orderable);
	const totalCents = orderable.reduce((s, w) => s + (w.lineCents ?? 0), 0);
	for (const w of orderable) {
		if (totalCents > m.orderCapCents) w.reasons.push('CAP_EXCEEDED.order');
		if (input.weekSpentCents + totalCents > m.weeklyCapCents) w.reasons.push('CAP_EXCEEDED.weekly');
		if (external) w.reasons.push('external_agent_needs_approval');
	}

	const lines: Line[] = work.map((w) => {
		const tier = w.orderable ? maxTier(w.reasons) : undefined;
		const state: Line['state'] = !w.orderable
			? 'unorderable'
			: tier === 'act'
				? 'eligible'
				: 'held';
		return {
			id: w.draft.id,
			needId: w.draft.needId,
			productId: w.draft.productId,
			productName: products.get(w.draft.productId)?.nameFi,
			qty: w.draft.qty,
			state,
			tier,
			reasons: w.reasons,
			offer: w.offer,
			lineCents: w.lineCents,
			substituteFor: w.draft.substituteFor,
			provenance: w.draft.provenance
		};
	});
	const all = [...(input.committed ?? []), ...lines];
	const heldLines = lines.filter((l) => l.state === 'held');
	const open = lines.some((l) => l.state === 'eligible' || l.state === 'held');
	const planState: PlanState = heldLines.length ? 'held' : open ? 'ready' : 'held';
	return {
		lines: all,
		planState,
		totalCents,
		termsLines: all
			.filter((l) => l.state !== 'unorderable' && l.state !== 'rejected' && l.offer?.price)
			.map((l) => ({
				productId: l.productId,
				qty: l.qty.value,
				unit: l.qty.unit,
				unitCents: l.offer!.price!.unitCents
			})),
		held: heldLines.length
			? { lineIds: heldLines.map((l) => l.id), tier: maxTier(heldLines.flatMap((l) => l.reasons)) }
			: null
	};
}

/** ISO 8601 week of a calendar date, e.g. 2026-11-16 → "2026-W47" (budget week = week of deliverBy). */
export function isoWeek(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	const day = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - day + 3);
	const year = d.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(year, 0, 4));
	const week =
		1 +
		Math.round(
			((d.getTime() - firstThursday.getTime()) / 864e5 -
				3 +
				((firstThursday.getUTCDay() + 6) % 7)) /
				7
		);
	return `${year}-W${String(week).padStart(2, '0')}`;
}
