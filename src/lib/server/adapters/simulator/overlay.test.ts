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

describe('workspace scope', () => {
	it('drives the served clock: each workspace ticks from its own run start', async () => {
		const { createDbPorts } = await import('$lib/server/store/db-ports');
		const { setCurrentRun } = await import('$lib/server/demo/run');
		const { SCENARIO } = await import('$lib/core/scenario');
		const { inWorkspace: scoped } = await import('./overlay');
		const now = Date.now();
		setCurrentRun('ws-clock-a', 'run-a', now);
		setCurrentRun('ws-clock-b', 'run-b', now - 3_600_000);
		const { ports } = await createDbPorts({ workspaceId: 'ws-clock-a', followCurrentRun: true });
		const start = new Date(SCENARIO.start).getTime();
		const a = scoped('ws-clock-a', () => ports.clock.now().getTime()) - start;
		const b = scoped('ws-clock-b', () => ports.clock.now().getTime()) - start;
		expect(a).toBeLessThan(60_000);
		expect(b).toBeGreaterThan(3_500_000);
	}, 60_000);
});
