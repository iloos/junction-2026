import { describe, expect, it } from 'vitest';
import type { Offer } from '$lib/core/contracts';
import { inWorkspace, SimOverlay } from './overlay';

const offer = {
	productId: 'p1',
	availability: { kind: 'known', amount: 15, logisticModel: 'Stock' },
	price: { unitCents: 100 }
} as unknown as Offer;
const amount = (o: Offer) => (o.availability as { amount?: number }).amount;

describe('SimOverlay scopes', () => {
	it("keeps one workspace's simulated scarcity out of every other workspace", () => {
		const o = new SimOverlay();
		inWorkspace('ws-a', () => o.setAvailability({ productId: 'p1', amount: 11, label: 'a' }));
		expect(inWorkspace('ws-a', () => amount(o.apply(offer)))).toBe(11);
		expect(inWorkspace('ws-b', () => amount(o.apply(offer)))).toBe(15);
		expect(amount(o.apply(offer))).toBe(15);
		inWorkspace('ws-b', () => o.clear());
		expect(inWorkspace('ws-a', () => amount(o.apply(offer)))).toBe(11);
		inWorkspace('ws-a', () => o.clear());
		expect(inWorkspace('ws-a', () => amount(o.apply(offer)))).toBe(15);
	});
	it('outside a scope (evals) writes the base layer, which every workspace sees under its own', async () => {
		const o = new SimOverlay();
		o.setPrice({ productId: 'p1', unitCents: 90, label: 'base' });
		inWorkspace('ws-a', () => o.setAvailability({ productId: 'p1', amount: 0, label: 'a' }));
		const a = await inWorkspace('ws-a', async () => {
			await Promise.resolve();
			return o.apply(offer);
		});
		expect(a.price?.unitCents).toBe(90);
		expect(a.availability.kind).toBe('out');
		expect(o.apply(offer).availability.kind).toBe('known');
		o.clear();
		expect(o.apply(offer).price?.unitCents).toBe(100);
	});
});
