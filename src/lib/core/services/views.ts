/**
 * Read models on tool outputs (never stored): each line's LineView (what may be done, physical amount, prices) and
 * the PlanView (as of the scenario clock, valid until, fulfilment per need). The facts the pure fulfilment needs
 * (packs, recipe ratios, substitute yields, receipts) are gathered here from the seed, the catalogue and the state.
 */
import type { Approval, Line, MeasureUnit, Plan, PlanView, Product } from '../contracts';
import { contentValue, rescueFor, seedEntryFor, type EventSeed, type SeedPack } from '../demand';
import {
	physicalOf,
	planFulfilment,
	pricesOf,
	type FulfilmentFacts,
	type PackContent
} from '../mandate/fulfilment';
import { withLineViews } from '../mandate/view';
import type { WorkspaceState } from '../state';
import type { ServicePorts } from './events';

/* eslint-disable @typescript-eslint/no-explicit-any -- seed rescue entries are loose JSON */
type Loose = any;

type ApprovalLike = Pick<Approval, 'state' | 'lineIds' | 'planVersion'> & Partial<Approval>;

/** A seed pack's content per sales unit, in the need's unit where the pack states it. */
function contentOf(
	pack: SeedPack | undefined,
	want: MeasureUnit | undefined
): PackContent | undefined {
	if (!pack) return undefined;
	if (want === 'l' && pack.netL) return { value: pack.netL, unit: 'l' };
	if (want === 'pcs' && pack.pieces) return { value: pack.pieces, unit: 'pcs' };
	if (pack.drainedKg) return { value: pack.drainedKg, unit: 'kg', basis: 'drained' };
	if (pack.netKg) return { value: pack.netKg, unit: 'kg', basis: 'net' };
	if (pack.netL) return { value: pack.netL, unit: 'l' };
	if (pack.pieces) return { value: pack.pieces, unit: 'pcs' };
	return undefined;
}

/** A recipe's per-unit word ("kg", "l", "eggs") as a measure unit; anything counted is pieces. */
const recipeUnitOf = (u: string | undefined): MeasureUnit =>
	u === undefined || u === 'kg' ? 'kg' : u === 'l' ? 'l' : 'pcs';

/** Committed line ids → whether the supplier confirmed them (by line id; by product on older receipts). */
function receiptsByLine(
	state: WorkspaceState,
	planId: string
): Map<string, 'confirmed' | 'awaiting'> {
	const out = new Map<string, 'confirmed' | 'awaiting'>();
	for (const o of Object.values(state.orders)) {
		if (o.planId !== planId) continue;
		const r = Object.values(state.receipts).find((x) => x.orderId === o.id);
		for (const ol of o.lines) {
			const confirmed = r?.confirmed.some((c) =>
				c.lineId ? c.lineId === ol.lineId : c.productId === ol.productId
			);
			out.set(ol.lineId, confirmed ? 'confirmed' : 'awaiting');
		}
	}
	return out;
}

export function factsFor(
	plan: Plan,
	products: Map<string, Product>,
	seed: EventSeed | undefined,
	state: WorkspaceState
): FulfilmentFacts {
	const needOf = (l: Line) => plan.needs.find((n) => n.id === l.needId);
	const dishOf = (l: Line) => seed?.dishes.find((d) => d.dish === needOf(l)?.label) as Loose;
	const ingredientOf = (l: Line) =>
		l.substituteFor
			? ((rescueFor(seed, l.substituteFor)?.chosen?.ingredients ?? []) as Loose[]).find(
					(g) => g.productId === l.productId
				)
			: undefined;
	const receipts = receiptsByLine(state, plan.id);
	return {
		pack(l) {
			const want = needOf(l)?.amount.unit;
			const g = ingredientOf(l);
			if (g?.pack) return { value: g.pack, unit: recipeUnitOf(g.perUnit) };
			const dish = dishOf(l);
			if (dish && dish.productId === l.productId && dish.pack) return contentOf(dish.pack, want);
			if (seed && dish && l.substituteFor) {
				const e = seedEntryFor(seed, dish.dish, l.substituteFor, l.productId);
				const c = contentOf(e.pack, want);
				if (c) return c;
			}
			const p = products.get(l.productId);
			const units: MeasureUnit[] = [...(want ? [want] : []), 'kg', 'l'];
			for (const unit of units) {
				const value = p ? contentValue(p, unit) : null;
				if (value) return { value, unit };
			}
			return undefined;
		},
		coverFactor(l) {
			const dish = dishOf(l);
			if (!seed || !dish || !l.substituteFor || ingredientOf(l)) return 1;
			const e = seedEntryFor(seed, dish.dish, l.substituteFor, l.productId);
			const dishYield = dish.yield ?? 1;
			return (e.yield ?? dishYield) / dishYield;
		},
		recipeUnit(l) {
			const g = ingredientOf(l);
			return g?.per && g?.pack ? g.pack / g.per : undefined;
		},
		receipt: (lineId) => receipts.get(lineId)
	};
}

/** The plan with every line's view (incl. physical amount and prices) and the plan view, as of `now`. */
export async function withPlanView(
	ports: ServicePorts,
	plan: Plan,
	state: WorkspaceState,
	approval: ApprovalLike | readonly ApprovalLike[] | null
): Promise<Plan> {
	const approvals = approval === null ? [] : Array.isArray(approval) ? approval : [approval];
	const products = await ports.catalog.get([...new Set(plan.lines.map((l) => l.productId))]);
	const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
	const facts = factsFor(plan, products, seed, state);
	const viewed = withLineViews(plan, approval);
	const lines = viewed.lines.map((l) => {
		const pack = facts.pack(l);
		const physical = physicalOf(l, pack);
		return { ...l, view: { ...l.view!, ...(physical ? { physical } : {}), ...pricesOf(l, pack) } };
	});
	const withLines = { ...viewed, lines };
	const kitchen = (await ports.store.kitchens(plan.workspaceId)).find(
		(k) => k.id === plan.kitchenId
	);
	const now = ports.clock.now();
	const live = (approvals as ApprovalLike[])
		.filter(
			(a) =>
				a.planVersion === plan.version &&
				(a.state === 'pending' || a.state === 'granted') &&
				a.expiresAt
		)
		.map((a) => a.expiresAt!);
	const cutoffs = lines
		.filter((l) => l.state !== 'committed' && (l.view.committable || l.view.reviewable))
		.map((l) => l.offer?.availability.closingTime)
		.filter((c): c is string => Boolean(c));
	const until = [...live, ...cutoffs].sort(
		(a, b) => new Date(a).getTime() - new Date(b).getTime()
	)[0];
	const view: PlanView = {
		asOf: now.toISOString(),
		mandateVersion: kitchen?.mandate.version ?? 1,
		...(until ? { validUntil: new Date(until).toISOString() } : {}),
		fulfilment: planFulfilment(withLines, facts)
	};
	return { ...withLines, view };
}
