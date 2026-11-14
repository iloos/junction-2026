/**
 * The stock model's inputs from a workspace: products are the ones its plans already priced (each line's offer is
 * Valio's answer at quote time: no extra fetch), draws are committed orders (drawn on their delivery day) and open
 * plans' lines (need, not yet drawn). Pure.
 */
import type { WorkspaceState } from '../state';
import type { Draw, StockProduct } from './model';

export function stockInputs(s: WorkspaceState): { products: StockProduct[]; draws: Draw[] } {
	const products = new Map<string, StockProduct>();
	const draws: Draw[] = [];
	for (const plan of Object.values(s.plans)) {
		const open = plan.state !== 'committed';
		for (const l of plan.lines) {
			const a = l.offer?.availability;
			if (a && !products.has(l.productId))
				products.set(l.productId, {
					productId: l.productId,
					name: l.productName ?? `Product ${l.productId}`,
					// No number (unknown) or unlimited: not forecast.
					start: a.kind === 'known' && a.amount != null && a.amount < 1e6 ? a.amount : null,
					asOf: a.availableDate ?? plan.deliverBy,
					logisticModel: a.logisticModel,
					unit: l.qty.unit
				});
			if (open && (l.state === 'eligible' || l.state === 'held' || l.state === 'proposed'))
				draws.push({
					productId: l.productId,
					day: plan.deliverBy,
					qty: l.qty.value,
					kitchenId: plan.kitchenId,
					committed: false
				});
		}
	}
	for (const o of Object.values(s.orders))
		for (const l of o.lines)
			draws.push({
				productId: l.productId,
				day: o.deliverBy,
				qty: l.qty.value,
				kitchenId: o.kitchenId,
				committed: true
			});
	return { products: [...products.values()], draws };
}
