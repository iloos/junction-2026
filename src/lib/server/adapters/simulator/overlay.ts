/**
 * Scenario overlays on top of cached Valio terms (D5: the simulator owns time and scarcity).
 * Every overridden value carries `source: 'simulator'` and the scenario's label, so the UI can say "simulated".
 */
import type { Offer } from '$lib/core/contracts';

export interface AvailabilityOverride {
	productId: string;
	/** Sales units available; 0 = out. */
	amount: number;
	label: string;
}
export interface PriceOverride {
	productId: string;
	unitCents: number;
	label: string;
}

export class SimOverlay {
	private availability = new Map<string, AvailabilityOverride>();
	private price = new Map<string, PriceOverride>();

	setAvailability(o: AvailabilityOverride) {
		this.availability.set(o.productId, o);
	}
	setPrice(o: PriceOverride) {
		this.price.set(o.productId, o);
	}
	clear() {
		this.availability.clear();
		this.price.clear();
	}

	apply(offer: Offer): Offer {
		let out = offer;
		const a = this.availability.get(offer.productId);
		if (a)
			out = {
				...out,
				availability: {
					...out.availability,
					kind: a.amount > 0 ? 'known' : 'out',
					amount: a.amount,
					// The overlay only models Stock: a simulated amount is a known quantity.
					logisticModel: out.availability.logisticModel ?? 'Stock',
					provenance: { source: 'simulator', note: a.label, ref: 'overlay' }
				}
			};
		const p = this.price.get(offer.productId);
		if (p && out.price)
			out = {
				...out,
				price: {
					...out.price,
					unitCents: p.unitCents,
					provenance: { source: 'simulator', note: p.label, ref: 'overlay' }
				}
			};
		return out;
	}
}
