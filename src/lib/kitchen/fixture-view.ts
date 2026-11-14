/**
 * Offline demonstration only: the browser fixture has no core read model, so it borrows one. Attaches the
 * FulfilmentView and line pack facts of a real get_plan output (fixtures/views/christmas-rescued.json, made by core
 * on the same seed) to the fixture plan. Needs are matched through their originally planned product (the fixture
 * names needs differently); lines by need + product, and only the pack facts (physical, unitPrice, comparisonPrice)
 * are borrowed, never states or actions. The borrowed coverage is the seed's default: an offline grams edit does not
 * move it. Live mode never uses this: the server sends its own view.
 */
import type { LineView, Plan } from '$lib/core/contracts';
import rescued from '../../../fixtures/views/christmas-rescued.json';

const ref = rescued as unknown as Plan;
const lineViews = new Map(ref.lines.map((l) => [`${l.needId}|${l.productId}`, l.view]));
/** Reference need id by the product first planned for it (a line that substitutes nothing). */
const refNeedByProduct = new Map(
	ref.lines.filter((l) => !l.substituteFor && l.needId).map((l) => [l.productId, l.needId!])
);

/** Pack facts borrowed for offline lines; the screen reads them where a live line carries `view`. */
export type Borrowed = Pick<LineView, 'physical' | 'unitPrice' | 'comparisonPrice'>;
/** By line id (store state is proxied, so object identity does not survive). */
export const borrowed = new Map<string, Borrowed>();

export function withFixtureView(plan: Plan): Plan {
	if (plan.view || plan.eventId !== ref.eventId) return plan;
	const toRef = new Map<string, string>();
	for (const l of plan.lines) {
		const r = !l.substituteFor && l.needId ? refNeedByProduct.get(l.productId) : undefined;
		if (r && !toRef.has(l.needId!)) toRef.set(l.needId!, r);
	}
	const fromRef = new Map([...toRef].map(([a, b]) => [b, a]));
	for (const l of plan.lines) {
		const v = lineViews.get(`${toRef.get(l.needId ?? '')}|${l.productId}`);
		if (!v) continue;
		borrowed.set(l.id, {
			physical: v.physical,
			unitPrice: v.unitPrice,
			comparisonPrice: v.comparisonPrice
		});
	}
	return {
		...plan,
		view: ref.view && {
			...ref.view,
			fulfilment: ref.view.fulfilment
				.filter((f) => fromRef.has(f.needId))
				.map((f) => ({ ...f, needId: fromRef.get(f.needId)! }))
		}
	};
}
