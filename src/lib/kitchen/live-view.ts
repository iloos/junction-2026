/**
 * The kitchen view model from the real plan (live mode). Same shapes as the fixture builder (fixture-plan.ts), but
 * every number comes from the server: needs and lines from get_plan, rankings from find_substitutes, product facts
 * from the catalogue. Pure: the server assembles the inputs (src/lib/server/kitchen/live.ts).
 */
import type {
	AvailabilityKind,
	Line,
	Measure,
	Offer,
	Plan,
	ScoreBreakdown,
	Tier,
	ToolOutput
} from '$lib/core/contracts';
import {
	NORMAL_WEEK,
	type CandidateView,
	type DishStatus,
	type DishView,
	type EventView,
	type MakeView,
	type PurchaseText,
	type RescueView,
	type Rules
} from './view-model';

export interface ProductFacts {
	name: string;
	origin?: string;
	reliability?: number;
	co2PerKg?: number;
	salesUnit: string;
	offer?: Offer;
}

export type SubstitutesOut = ToolOutput<'find_substitutes'>;

export interface LiveInput {
	plan: Plan;
	/** find_substitutes (preview) per planned line that is a real outage. */
	rescues: Record<string, SubstitutesOut>;
	facts: Record<string, ProductFacts>;
	seed: {
		title: string;
		date: string;
		guests: number;
		serviceStyle: string;
		/** The seed's hand-checked rescue entries, keyed like "whole-ham-462490". */
		rescue?: Record<string, LooseRescue>;
	};
	rules: Rules;
	weekSpentCents: number;
	/** The rule preset in force: under a non-default preset the preview's rank 1 is shown as the choice. */
	previewRanking: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- seed rescue entries are loose JSON */
type LooseRescue = any;

const AVAIL_TEXT: Record<AvailabilityKind, string> = {
	known: 'in stock',
	unknown: 'quantity unknown (supplier-delivered)',
	out: 'out of stock',
	undeliverable: 'not deliverable',
	blocked: 'not orderable yet'
};
const RANK: Record<Tier, number> = { act: 0, propose: 1, sign_off: 2 };
const f1 = (v: number) => v.toFixed(1);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function availText(o?: Offer): string {
	const a = o?.availability;
	if (!a) return 'no availability data';
	if (a.kind === 'known')
		return a.amount === null ? 'in stock (no limit stated)' : `${a.amount} in stock`;
	return AVAIL_TEXT[a.kind];
}

/** "Joulukinkku (Christmas ham)" → Finnish and English names; "Riisipuuro (rice porridge): rice" keeps the part. */
function names(label: string): { nameFi: string; name: string } {
	// "Graavilohi (cured salmon), cured in-house" and "Riisipuuro (rice porridge): rice" keep their tail.
	const m = label.match(/^([^(]+?)\s*\(([^)]+)\)\s*(.*)$/);
	if (!m) return { nameFi: label, name: label };
	const tail = m[3].replace(/^[:,]\s*/, '');
	const part = tail ? `: ${tail}` : '';
	const en = m[2].charAt(0).toUpperCase() + m[2].slice(1);
	return { nameFi: m[3].startsWith(':') ? `${m[1]}${part}` : m[1], name: `${en}${part}` };
}

const isOpen = (l: Line) => l.state === 'eligible' || l.state === 'held';
/** Supply with no stated quantity, and short stock, from the server's read model. */
const hasUnknown = (l: Line) =>
	(l.view?.unknownStockCover.value ?? 0) > 0 || l.view?.blockedReason?.detail === 'qty';
const isShort = (l: Line) => l.view?.blockedReason?.detail === 'stock';

function verdict(c: CandidateView): string {
	if (c.rejected.includes('out')) return 'Rejected: out of stock (0)';
	if (c.rejected.includes('undeliverable')) return "Rejected: Valio can't deliver it here";
	if (c.rejected.includes('origin_required'))
		return `Rejected: origin ${c.origin?.toUpperCase() ?? '?'}, your rules require FI`;
	if (c.rejected.includes('BELOW_LOT')) return "Rejected: less than one of Valio's lots left";
	if (c.rejected.includes('INSUFFICIENT_STOCK'))
		return 'Rejected: not enough in stock for the need';
	if (c.rejected.includes('low_reliability')) return 'Rejected: delivery reliability below 0.7';
	if (c.rejected.length) return `Rejected: ${c.rejected.join(', ')}`;
	if (c.cautions?.length)
		return `Caution: ${c.cautionNote ?? 'Gemini flags a hard constraint, check'} · needs sign-off`;
	if (c.kind === 'unknown') return 'Terminal: unknown quantity never counts as cover';
	if (c.partial) return `Partial: covers ${f1(c.coverValue)} kg`;
	if (c.tier === 'sign_off') return 'Known stock for the whole need · needs sign-off';
	if (c.tier === 'propose') return 'Known stock for the whole need · needs your approval';
	return 'Known stock for the whole need · within your mandate';
}

function candidateViews(
	out: SubstitutesOut,
	chosenLine: Line | undefined,
	facts: Record<string, ProductFacts>,
	previewRanking: boolean
): CandidateView[] {
	return out.candidates.map((c) => {
		const f = facts[c.productId];
		const o = f?.offer;
		// `chosen` = in the order now; `recommended` = what the previewed rules would pick.
		const isChosen = chosenLine?.productId === c.productId;
		const recommended = out.chosen.some((l) => l.productId === c.productId);
		void previewRanking;
		const line = chosenLine?.productId === c.productId ? chosenLine : undefined;
		const partial = Boolean(line?.reasons.includes('INSUFFICIENT_STOCK'));
		const view: CandidateView = {
			productId: c.productId,
			name: c.productName ?? f?.name ?? c.productId,
			origin: f?.origin,
			kind: o?.availability.kind ?? 'unknown',
			logistic: o?.availability.logisticModel ?? null,
			availableText: availText(o),
			perKgCents:
				o?.price?.comparison?.unit === 'kg'
					? o.price.comparison.cents
					: (o?.price?.unitCents ?? null),
			qty: line?.qty.value ?? null,
			unit: line?.qty.unit ?? f?.salesUnit ?? '',
			rounding: line?.qty.rounding,
			lineCents: line?.lineCents ?? null,
			coverValue:
				partial && o?.availability.amount != null ? o.availability.amount : (line?.qty.value ?? 0),
			partial,
			rank: c.rank,
			score: c.score as ScoreBreakdown | undefined,
			rejected: c.rejectedReasons.filter((r) => !r.startsWith('CAUTION.')),
			cautions: c.rejectedReasons.filter((r) => r.startsWith('CAUTION.')),
			cautionNote: c.caution,
			holdReasons: line ? line.reasons.filter((r) => r !== 'UNKNOWN_REQUIRED') : [],
			tier: line?.tier ?? (c.rank ? 'propose' : 'act'),
			chosen: isChosen,
			recommended,
			verdict: '',
			reliability: f?.reliability,
			co2PerKg: f?.co2PerKg
		};
		view.verdict = verdict(view);
		return view;
	});
}

const purchase = (l: Line, facts: Record<string, ProductFacts>): PurchaseText => ({
	productId: l.productId,
	name: l.productName ?? facts[l.productId]?.name ?? l.productId,
	qtyText: `${l.qty.value} ${l.qty.unit}`
});

/** What the rules recommend vs what the order holds; they differ by product or quantity. */
function previewOf(out: SubstitutesOut, facts: Record<string, ProductFacts>) {
	const recommended = out.chosen.map((l) => purchase(l, facts));
	const saved = (out.saved ?? []).map((l) => purchase(l, facts));
	const key = (xs: PurchaseText[]) =>
		xs
			.map((x) => `${x.productId}:${x.qtyText}`)
			.sort()
			.join('|');
	return { recommended, saved, differs: key(recommended) !== key(saved) };
}

function makeView(
	nameFi: string,
	lines: Line[],
	out: SubstitutesOut,
	seedRescue: LooseRescue,
	facts: Record<string, ProductFacts>
): MakeView {
	const chosen = seedRescue?.chosen ?? {};
	const ingredients = lines.map((l) => ({
		productId: l.productId,
		name: l.productName ?? facts[l.productId]?.name ?? l.productId,
		origin: facts[l.productId]?.origin,
		need: l.qty.rounding ?? `${l.qty.value} ${l.qty.unit}`,
		qty: l.qty.value,
		unit: l.qty.unit,
		lineCents: l.lineCents ?? 0,
		availText: availText(l.offer ?? undefined)
	}));
	const caveats: string[] = chosen.caveats ?? [];
	const tier = lines.reduce<Tier>((t, l) => (l.tier && RANK[l.tier] > RANK[t] ? l.tier : t), 'act');
	const lower = nameFi.toLowerCase();
	return {
		title: lower.includes('torttu') ? `Bake ${lower} in house` : `Make ${lower} in house`,
		ingredients,
		totalCents: ingredients.reduce((s, i) => s + i.lineCents, 0),
		vsReadyMadeCents: chosen.vsReadyMadeCents ?? 0,
		labourNote: out.labourNote ?? chosen.recipe?.labour ?? '',
		allergenNote: caveats.find((c) => /allergen/i.test(c)),
		caveats: caveats.filter((c) => !/allergen/i.test(c)),
		tier,
		holdReasons: [...new Set(lines.flatMap((l) => l.reasons))],
		chosen: true,
		recipeNote: chosen.recipe?.provenance ?? 'team estimate'
	};
}

function seedRescueFor(input: LiveInput, productId: string): LooseRescue {
	const r = input.seed.rescue ?? {};
	const key = Object.keys(r).find((k) => k.endsWith(`-${productId}`));
	return key ? r[key] : undefined;
}

export function buildLiveView(input: LiveInput): EventView {
	const { plan, facts } = input;
	const dishes: DishView[] = plan.needs.map((need) => {
		const { nameFi, name } = names(need.label);
		const dishLines = plan.lines.filter((l) => l.needId === need.id);
		const planned = dishLines.find((l) => !l.substituteFor) ?? dishLines[0];
		const subs = dishLines.filter((l) => l.substituteFor);
		const outage =
			planned?.state === 'unorderable' && planned.reasons.includes('out')
				? ('out' as const)
				: planned?.state === 'unorderable' && planned.reasons.includes('undeliverable')
					? ('undeliverable' as const)
					: undefined;
		const yieldV = need.dish?.yield ?? 1;
		const served: Measure =
			need.amount.unit === 'kg'
				? { value: r2(need.amount.value * yieldV), unit: 'kg' }
				: need.amount;

		let status: DishStatus = 'ok';
		if (outage) {
			if (!subs.length) status = 'shortfall';
			else if (subs.some(isShort)) status = 'partial';
			else status = 'rescued';
		} else if (dishLines.some((l) => isOpen(l) && hasUnknown(l))) status = 'unknown';

		let rescue: RescueView | undefined;
		const out = planned ? input.rescues[planned.id] : undefined;
		if (outage && out) {
			const productSub = subs.find((l) => !l.id.includes('-mih-'));
			const kind = out.kind;
			const short = productSub?.reasons.includes('INSUFFICIENT_STOCK');
			const left = productSub?.offer?.availability.amount;
			rescue = {
				forLineId: planned!.id,
				kind,
				needServed: served,
				candidates: candidateViews(out, productSub, facts, input.previewRanking),
				preview: previewOf(out, facts),
				make:
					kind === 'make_in_house'
						? makeView(nameFi, subs, out, seedRescueFor(input, planned!.productId), facts)
						: undefined,
				residual:
					kind === 'none'
						? {
								value: served.value,
								unit: served.unit,
								text: `No candidate qualifies: ${f1(served.value)} ${served.unit} uncovered`
							}
						: short && productSub
							? {
									value: served.value,
									unit: served.unit,
									text: `Only ${left ?? '?'} ${productSub.qty.unit} left of the ${productSub.qty.value} needed (simulated contention): held until covered or replaced`
								}
							: undefined,
				summary:
					kind === 'make_in_house'
						? `No ready-made ${nameFi.toLowerCase()} can be delivered. Make it from in-stock ingredients.`
						: kind === 'none'
							? `Nothing qualifies under your rules. ${nameFi} is a shortfall.`
							: short
								? `${productSub?.productName ?? productSub?.productId} no longer covers the need: stock was taken by another kitchen.`
								: productSub && hasUnknown(productSub)
									? `${productSub.productName ?? productSub.productId} is the pick under these rules, but Valio states no quantity for it: ${f1(served.value)} ${served.unit} stays unconfirmed, not cover.`
									: `${productSub?.productName ?? productSub?.productId} has known stock for the full ${f1(served.value)} ${served.unit} served (planned, not reserved).`
			};
		}

		const usual = planned ? NORMAL_WEEK.usual[planned.productId] : undefined;
		const priceCents = planned?.offer?.price?.unitCents ?? 0;
		return {
			id: need.id.replace(/^need:/, ''),
			needId: need.id,
			name,
			nameFi,
			gServed: need.dish?.gServed ?? 0,
			gDefault: need.dish?.defaultGServed ?? 0,
			editable: Boolean(need.dish) && !dishLines.some((l) => l.state === 'committed'),
			yield: yieldV,
			need: need.amount,
			needFormula: need.dish?.formula ?? `${need.amount.value} ${need.amount.unit}`,
			productId: planned?.productId ?? '',
			productName: planned?.productName ?? planned?.productId ?? '',
			plannedLineId: planned?.id ?? '',
			lineIds: dishLines.map((l) => l.id),
			status,
			outage,
			usual: usual ? { ...usual, cents: Math.round(usual.qty * priceCents) } : undefined,
			isNew: !usual,
			rescue,
			eventCents: dishLines
				.filter((l) => l.state !== 'unorderable' && l.state !== 'rejected')
				.reduce((s, l) => s + (l.lineCents ?? 0), 0)
		};
	});

	const live = plan.lines.filter((l) => l.state !== 'unorderable' && l.state !== 'rejected');
	const eventCents = live.reduce((s, l) => s + (l.lineCents ?? 0), 0);
	const newLines = live.filter((l) => !NORMAL_WEEK.usual[l.productId]).length;
	const planReasons = [
		...new Set(
			plan.lines.flatMap((l) =>
				l.reasons.filter((r) => r === 'CAP_EXCEEDED.order' || r === 'CAP_EXCEEDED.weekly')
			)
		)
	];
	return {
		eventId: plan.eventId ?? '',
		title: input.seed.title,
		date: input.seed.date,
		guests: input.seed.guests,
		serviceStyle: input.seed.serviceStyle,
		dishes,
		why: {},
		normalWeek: { cents: NORMAL_WEEK.cents, lines: NORMAL_WEEK.lines },
		thisWeek: { cents: NORMAL_WEEK.cents + eventCents, lines: NORMAL_WEEK.lines + newLines },
		eventKg: r2(plan.needs.reduce((s, n) => s + (n.amount.unit === 'kg' ? n.amount.value : 0), 0)),
		planReasons,
		weekSpentCents: input.weekSpentCents,
		counts: {
			outages: dishes.filter((d) => d.outage).length,
			unknown: plan.lines.filter((l) => isOpen(l) && hasUnknown(l)).length,
			held: plan.lines.filter((l) => l.state === 'held').length,
			eligible: plan.lines.filter((l) => l.state === 'eligible').length,
			committed: plan.lines.filter((l) => l.state === 'committed').length
		}
	};
}
