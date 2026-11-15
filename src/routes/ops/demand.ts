/**
 * Demand, Valio's view of the same run: for each delivery day, what every kitchen has ordered, signed and still
 * proposes per product, the exceptions settled on the way (substitutes and make-in-house accepted, lines ordered on
 * stock of unknown quantity, which a person waived) and the reason each change carries. Read-only and derived
 * from the order stages (core/services/stages.ts); nothing here is stored or written.
 */
import type { Line } from '$lib/core/contracts';
import type { OrderStages } from '$lib/core/services/stages';
import { day } from '$lib/ui/format';
import { salesUnitWords } from '$lib/ui/request/words';

export type Stage = 'ordered' | 'signed' | 'proposed';

export interface DemandProduct {
	productId: string;
	name: string;
	unit: string;
	/** Quantities in the product's sales unit, by stage. */
	ordered: number;
	signed: number;
	proposed: number;
	kitchens: number;
	cents: number;
}

export interface DemandDay {
	date: string;
	day: string;
	/** "Thu 10 Dec: 2 kitchens, 41 lines, 2 swaps accepted before cut-off." */
	sentence: string;
	products: DemandProduct[];
	/** Substitutes and make-in-house a person accepted (signed or ordered). */
	swaps: string[];
	/** Lines ordered or signed with no stock info in the catalogue. */
	waived: string[];
	/** Why quantities moved: the chef's and the agents' edits, in their words. */
	reasons: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const name = (l: Pick<Line, 'productId' | 'productName'>) =>
	l.productName ?? `Product ${l.productId}`;

/** Where a live line stands: ordered, signed by a person (not yet ordered), or proposed. Null for dead lines. */
function stageOf(l: Line, granted: Set<string>): Stage | null {
	if (l.state === 'committed') return 'ordered';
	if (l.state === 'rejected' || l.state === 'unorderable') return null;
	return granted.has(l.id) ? 'signed' : 'proposed';
}

export function demandByDay(
	stages: OrderStages[],
	kitchenName: (id: string) => string
): DemandDay[] {
	const byDay = new Map<string, OrderStages[]>();
	for (const s of stages) byDay.set(s.deliverBy, [...(byDay.get(s.deliverBy) ?? []), s]);

	return [...byDay.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, plans]) => {
			const products = new Map<string, DemandProduct & { kitchenIds: Set<string> }>();
			const swapsBy = new Map<
				string,
				{ kitchen: string; was: string; inHouse: boolean; products: string[]; before: boolean }
			>();
			const waived: string[] = [];
			const reasons: string[] = [];
			let lines = 0;

			for (const s of plans) {
				const granted = new Set(
					s.signed.filter((a) => a.state === 'granted').flatMap((a) => a.lineIds)
				);
				const kitchen = kitchenName(s.kitchenId);
				const settledAt = new Map<string, string>();
				for (const a of s.signed)
					if (a.state === 'granted') for (const id of a.lineIds) settledAt.set(id, a.at);
				for (const o of s.ordered) for (const l of o.lines) settledAt.set(l.lineId, o.at);

				for (const l of s.plan.lines) {
					const stage = stageOf(l, granted);
					if (!stage) continue;
					lines += 1;
					const key = `${l.productId}|${l.qty.unit}`;
					const p = products.get(key) ?? {
						productId: l.productId,
						name: name(l),
						unit: l.qty.unit,
						ordered: 0,
						signed: 0,
						proposed: 0,
						kitchens: 0,
						cents: 0,
						kitchenIds: new Set<string>()
					};
					p[stage] += l.qty.value;
					p.cents += l.lineCents ?? 0;
					p.kitchenIds.add(s.kitchenId);
					products.set(key, p);

					const settled = stage !== 'proposed';
					const cutoff = l.offer?.availability.closingTime;
					const at = settledAt.get(l.id);
					if (settled && l.substituteFor) {
						// One swap per replaced product: a recipe's ingredients are one accepted change.
						const k = `${s.planId}|${l.substituteFor}`;
						const sw = swapsBy.get(k) ?? {
							kitchen,
							was: name(
								s.plan.lines.find((x) => x.productId === l.substituteFor) ??
									({ productId: l.substituteFor } as Line)
							),
							inHouse: l.strategy?.kind === 'make_in_house',
							products: [] as string[],
							before: true
						};
						sw.products.push(name(l));
						sw.before &&= !!(cutoff && at && new Date(at) <= new Date(cutoff));
						swapsBy.set(k, sw);
					}
					if (settled && l.offer?.availability.kind === 'unknown')
						waived.push(
							`${kitchen}: ${name(l)}, ${stage === 'ordered' ? 'ordered' : 'signed'} with no stock info in the catalogue.`
						);
				}
				for (const c of s.proposed.changes)
					if (c.kind === 'edit') reasons.push(`${kitchen}: ${c.text.replace(/^[^:]+: /, '')}`);
			}

			const swaps = [...swapsBy.values()].map((w) =>
				w.inHouse
					? `${w.kitchen}: ${w.was}, made in house from ${plural(w.products.length, 'ingredient')}${w.before ? ', before the cut-off' : ''}.`
					: `${w.kitchen}: ${w.products[0]} instead of ${w.was}${w.before ? ', before the cut-off' : ''}.`
			);
			const beforeCutoff = [...swapsBy.values()].filter((w) => w.before).length;
			const list = [...products.values()]
				.map(({ kitchenIds, ...p }) => ({ ...p, kitchens: kitchenIds.size }))
				.sort((a, b) => b.cents - a.cents);
			const kitchens = new Set(plans.map((s) => s.kitchenId)).size;
			const swapCount = swaps.length;
			const parts = [
				plural(kitchens, 'kitchen'),
				plural(lines, 'line'),
				...(swapCount
					? [
							beforeCutoff === swapCount
								? `${plural(swapCount, 'swap')} accepted before the cut-off`
								: `${plural(swapCount, 'swap')} accepted`
						]
					: [])
			];
			return {
				date,
				day: day(date),
				sentence: `${day(date)}: ${parts.join(', ')}.`,
				products: list,
				swaps,
				waived,
				reasons
			};
		});
}

/** "12 kg" / "3 cases". */
export const amount = (value: number, unit: string) => salesUnitWords(value, unit);
