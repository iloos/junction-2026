/**
 * Offline stand-in only: the browser fixture has no server read model, so it builds the parts it can and borrows the
 * rest. Every line gets core's own `lineView` (the same pure rule the server uses, against the fixture's approvals),
 * plus the pack facts (physical, unitPrice, comparisonPrice) of a real get_plan output on the same seed
 * (fixtures/views/christmas-rescued.json). The plan gets that output's FulfilmentView. Needs are matched through their
 * originally planned product (the fixture names needs differently), lines by need + product. The borrowed coverage is
 * the seed's default: an offline grams edit does not move it (the label says so). Live mode never uses this.
 */
import type { Approval, Plan } from '$lib/core/contracts';
import { lineView } from '$lib/core/mandate/view';
import rescued from '../../../fixtures/views/christmas-rescued.json';

const ref = rescued as unknown as Plan;
const key = (needId: string | undefined, productId: string) => `${needId}|${productId}`;
const refLines = new Map(ref.lines.map((l) => [key(l.needId, l.productId), l]));
/** Reference need id by the product first planned for it (a line that substitutes nothing). */
const refNeedByProduct = new Map(
	ref.lines.filter((l) => !l.substituteFor && l.needId).map((l) => [l.productId, l.needId!])
);

export function withFixtureView(plan: Plan, approvals: readonly Approval[]): Plan {
	const current = approvals.filter((a) => a.planVersion === plan.version);
	const sameEvent = plan.eventId === ref.eventId;
	const toRef = new Map<string, string>();
	if (sameEvent)
		for (const l of plan.lines) {
			const r = !l.substituteFor && l.needId ? refNeedByProduct.get(l.productId) : undefined;
			if (r && !toRef.has(l.needId!)) toRef.set(l.needId!, r);
		}
	const fromRef = new Map([...toRef].map(([a, b]) => [b, a]));
	const lineFromRef = new Map<string, string>();
	const lines = plan.lines.map((l) => {
		const r = sameEvent ? refLines.get(key(toRef.get(l.needId ?? ''), l.productId)) : undefined;
		if (r) lineFromRef.set(r.id, l.id);
		return {
			...l,
			view: {
				...lineView(l, plan, current),
				physical: r?.view?.physical,
				unitPrice: r?.view?.unitPrice,
				comparisonPrice: r?.view?.comparisonPrice
			}
		};
	});
	return {
		...plan,
		lines,
		view:
			sameEvent && ref.view
				? {
						...ref.view,
						fulfilment: ref.view.fulfilment
							.filter((f) => fromRef.has(f.needId))
							.map((f) => ({
								...f,
								needId: fromRef.get(f.needId)!,
								allocations: f.allocations
									.filter((a) => lineFromRef.has(a.lineId))
									.map((a) => ({ ...a, lineId: lineFromRef.get(a.lineId)! }))
							}))
					}
				: plan.view
	};
}
