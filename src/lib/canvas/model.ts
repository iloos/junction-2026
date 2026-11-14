import type { Line, Measure, Need, NeedRequirements } from '$lib/core/contracts';
import { mergeRequirements } from '$lib/core/mandate/validate';
import type { FixtureSnapshot } from '$lib/kitchen/fixture-server';
import type { DishStatus, DishView } from '$lib/kitchen/view-model';
import { marksOf, type DietFacts, type Marks } from '$lib/ui/diet';

export type CanvasSnapshot = Pick<FixtureSnapshot, 'plan' | 'view' | 'diet' | 'shortNames'>;

export interface CanvasLine {
	id: string;
	productId: string;
	name: string;
	qty: Line['qty'];
	physical?: Measure;
	state: Line['state'];
	lineCents: number | null;
	substituteFor?: string;
	/** Product records are facts, separate from the need's desired requirements. */
	diet?: DietFacts;
	marks: Marks;
	line: Line;
}

export interface CanvasConnection {
	id: string;
	from: string;
	to: string;
	kind: 'need-line' | 'replacement';
}

export interface CanvasItem {
	/** Focus identity is the requirement, even when several requirements buy the same product. */
	id: string;
	needId: string;
	label: string;
	/** The plan's demand amount, never the display's served amount or a purchase-pack quantity. */
	amount: Measure;
	ask?: Need['ask'];
	requirements?: NeedRequirements & { conflict?: string };
	unresolved?: string;
	source?: Need['source'];
	status: DishStatus;
	dish?: DishView;
	/** Includes retired original lines for the Why chain. */
	lines: CanvasLine[];
	/** Actual active purchases, including split originals and substitutes, each once. */
	currentLines: CanvasLine[];
	connections: CanvasConnection[];
}

export interface CanvasGroup {
	id: string;
	label: string;
	dishId?: string;
	proposalId?: string;
	status: DishStatus;
	unresolvedCount: number;
	items: CanvasItem[];
	/** Older direct orders may have lines without a Need; they never acquire invented recipe lineage. */
	unlinkedLines: CanvasLine[];
}

export interface CanvasProjection {
	planId: string;
	/** The quoted plan total is authoritative; this projection does not reprice or add source/substitute costs. */
	totalCents: number | null;
	groups: CanvasGroup[];
	items: CanvasItem[];
	lines: CanvasLine[];
	unlinkedLines: CanvasLine[];
	connections: CanvasConnection[];
}

const key = (kind: string, parts: string[]) => `${kind}:${JSON.stringify(parts)}`;
const active = (l: CanvasLine) =>
	l.qty.value > 0 &&
	l.state !== 'rejected' &&
	l.state !== 'unorderable' &&
	!l.line.reasons.includes('superseded');

function statusFor(
	need: Need,
	current: CanvasLine[],
	dish: DishView | undefined,
	unresolved: Measure | undefined
): DishStatus {
	if (unresolved && unresolved.value > 0) return current.length ? 'partial' : 'shortfall';
	if (!current.length && need.amount.value > 0) return 'shortfall';
	if (dish) return dish.status;
	if (current.some((l) => l.substituteFor)) return 'rescued';
	if (current.some((l) => l.line.offer?.availability.kind === 'unknown')) return 'unknown';
	return 'ok';
}

function groupStatus(items: CanvasItem[], loose: CanvasLine[]): DishStatus {
	const states = items.map((i) => i.status);
	if (states.includes('partial')) return 'partial';
	if (states.includes('shortfall'))
		return states.every((s) => s === 'shortfall') ? 'shortfall' : 'partial';
	if (states.includes('unknown')) return 'unknown';
	if (states.includes('rescued')) return 'rescued';
	if (loose.some((l) => !active(l))) return 'unknown';
	return 'ok';
}

/** A menu ingredient view names its recipe before the separator; ids never become visible labels. */
function recipeLabel(dish: DishView | undefined): string | undefined {
	const name = dish?.name;
	const at = name?.indexOf(' · ') ?? -1;
	return name && at > 0 ? name.slice(0, at).trim() : undefined;
}

/**
 * A pure projection of the plan on screen. Recipe groups require explicit menu lineage; products, labels and
 * fixture seeds never imply a recipe relationship. Every requirement and every purchase line remains visible.
 */
export function projectCanvas(snap: CanvasSnapshot): CanvasProjection {
	const { plan } = snap;
	const lines: CanvasLine[] = plan.lines.map((raw) => {
		const line = structuredClone(raw);
		const diet = snap.diet?.[line.productId];
		return {
			id: line.id,
			productId: line.productId,
			name: snap.shortNames?.[line.productId] ?? line.productName ?? 'Product',
			qty: line.qty,
			...(line.view?.physical ? { physical: line.view.physical } : {}),
			state: line.state,
			lineCents: line.lineCents,
			...(line.substituteFor ? { substituteFor: line.substituteFor } : {}),
			...(diet ? { diet: structuredClone(diet) } : {}),
			marks: marksOf(diet),
			line
		};
	});
	const byNeed = new Map<string, CanvasLine[]>();
	const needIds = new Set(plan.needs.map((n) => n.id));
	const unlinkedLines: CanvasLine[] = [];
	for (const line of lines) {
		const id = line.line.needId;
		if (!id || !needIds.has(id)) unlinkedLines.push(line);
		else {
			const linked = byNeed.get(id) ?? [];
			linked.push(line);
			byNeed.set(id, linked);
		}
	}
	const dishes = new Map(snap.view.dishes.map((d) => [d.needId, d]));
	const fulfilment = new Map(plan.view?.fulfilment.map((f) => [f.needId, f]) ?? []);
	const groups = new Map<string, CanvasGroup>();
	const ingredients = () => {
		const id = 'ingredients';
		let group = groups.get(id);
		if (!group) {
			group = {
				id,
				label: 'Ingredients',
				status: 'ok',
				unresolvedCount: 0,
				items: [],
				unlinkedLines: []
			};
			groups.set(id, group);
		}
		return group;
	};
	const items: CanvasItem[] = plan.needs.map((raw) => {
		const need = structuredClone(raw);
		const rawDish = dishes.get(need.id);
		const dish = rawDish ? structuredClone(rawDish) : undefined;
		const linked = byNeed.get(need.id) ?? [];
		const currentLines = linked.filter(active);
		const connections: CanvasConnection[] = linked.map((l) => ({
			id: key('need-line', [need.id, l.id]),
			from: need.id,
			to: l.id,
			kind: 'need-line'
		}));
		for (const replacement of linked) {
			if (!replacement.substituteFor) continue;
			const originals = linked.filter(
				(l) => l.id !== replacement.id && l.productId === replacement.substituteFor
			);
			// A product reference is insufficient to identify one of two matching source lines.
			if (originals.length === 1)
				connections.push({
					id: key('replacement', [originals[0].id, replacement.id]),
					from: originals[0].id,
					to: replacement.id,
					kind: 'replacement'
				});
		}
		const item: CanvasItem = {
			id: need.id,
			needId: need.id,
			label: need.label,
			amount: need.amount,
			...(need.ask ? { ask: need.ask } : {}),
			...(need.source ? { source: need.source } : {}),
			...(need.unresolved ? { unresolved: need.unresolved } : {}),
			...(dish ? { dish } : {}),
			...(plan.requirements || need.requirements
				? { requirements: mergeRequirements(plan.requirements, need.requirements) }
				: {}),
			status: statusFor(need, currentLines, dish, fulfilment.get(need.id)?.unresolved),
			lines: linked,
			currentLines,
			connections
		};
		let group: CanvasGroup;
		if (need.source) {
			const { proposalId, dishId } = need.source;
			const id = key('recipe', [proposalId, dishId]);
			group = groups.get(id) ?? {
				id,
				label: recipeLabel(dish) ?? 'Recipe ingredients',
				proposalId,
				dishId,
				status: 'ok',
				unresolvedCount: 0,
				items: [],
				unlinkedLines: []
			};
			if (group.label === 'Recipe ingredients') group.label = recipeLabel(dish) ?? group.label;
			groups.set(id, group);
		} else group = ingredients();
		group.items.push(item);
		return item;
	});
	if (unlinkedLines.length) ingredients().unlinkedLines = unlinkedLines;
	for (const group of groups.values()) {
		group.status = groupStatus(group.items, group.unlinkedLines);
		group.unresolvedCount = group.items.filter(
			(i) => i.status === 'shortfall' || i.status === 'partial'
		).length;
	}
	return {
		planId: plan.id,
		totalCents: plan.totalCents,
		groups: [...groups.values()],
		items,
		lines,
		unlinkedLines,
		connections: items.flatMap((i) => i.connections)
	};
}
