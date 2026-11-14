import { describe, expect, it } from 'vitest';
import { toolSchemas, type Kitchen } from '$lib/core/contracts';
import { createGetContext } from '$lib/server/agent/get-context';
import { trialWorkspace } from '$lib/server/agent/trial-harness';
import { kitchenHistory, planUsualOrder, readUsualOrder } from './usual';

const kitchenOf = async (w: Awaited<ReturnType<typeof trialWorkspace>>, id: string) =>
	(await w.env.ports.store.kitchens(w.env.workspaceId)).find((k) => k.id === id) as Kitchen;

describe('usual order: server read path', () => {
	it(
		'names and prices the usual order through the catalogue port, read-only',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const hotel = await kitchenOf(w, 'k-hotel');
			const v = await readUsualOrder(w.env.ports, hotel, {
				asOf: '2026-12-07',
				deliveryDate: '2026-12-10'
			});
			expect(v.label).toBe('simulated history');
			expect(v.kitchenId).toBe('k-hotel');
			expect(v.settled).toBe(true);
			expect(v.lines.length).toBeGreaterThanOrEqual(3);
			for (const l of v.lines) {
				expect(l.name).not.toBe(l.productId);
				expect(l.rhythm).toMatch(/^every /);
			}
			expect(v.lines.filter((l) => l.unitCents !== null).length).toBeGreaterThan(0);
			expect(v.totalCents).toBe(v.lines.reduce((n, l) => n + (l.lineCents ?? 0), 0));
			expect(v.joined.map((c) => c.productId)).toEqual(['464320']);
			expect(v.dropped.map((c) => c.name)).toEqual([expect.stringMatching(/KIRJOLOHI/i)]);
			expect(w.ops).toHaveLength(0);
		}
	);

	it('defaults to the sim today and the next receiving day', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const lounas = await kitchenOf(w, 'k-lounas');
		const v = await readUsualOrder(w.env.ports, lounas);
		expect(v.asOf).toBe('2026-11-14'); // the trial clock's Saturday
		expect(v.deliveryDate).toBe('2026-11-16'); // Monday: lounas receives Mon/Wed/Fri
		expect(
			kitchenHistory(lounas, v.asOf).lines.every((l) => l.source === 'simulated history')
		).toBe(true);
	});

	it(
		'get_context carries each kitchen’s usual-order slice, schema-valid',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const r = await createGetContext(w.env.ports)(w.ctx('external_agent'), {});
			if (!r.ok) throw new Error('get_context failed');
			expect(toolSchemas.get_context.output.safeParse(r.value).success).toBe(true);
			const central = r.value.kitchens.find((k) => k.id === 'k-central')!;
			expect(central.usual?.label).toBe('simulated history');
			expect(central.usual?.deliveryDate).toBe('2026-11-16');
			expect(central.usual?.lines.length).toBeGreaterThan(0);
			expect(central.usual?.lines[0].sentence).toMatch(/^seen \d+ of the last \d+ /);
			expect(w.ops).toHaveLength(0);
		}
	);

	it(
		'"plan this usual order" goes through place_order and applyOps, like any order',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const lounas = await kitchenOf(w, 'k-lounas');
			const v = await readUsualOrder(w.env.ports, lounas);
			const placed = await planUsualOrder(w.handlers, w.ctx('kitchen_agent'), v);
			expect(placed.plan.kitchenId).toBe('k-lounas');
			expect(placed.plan.lines.map((l) => l.productId).sort()).toEqual(
				v.lines.map((l) => l.productId).sort()
			);
			expect(w.ops.length).toBeGreaterThan(0);
			// The same lines again replay the same plan (idempotent per key).
			const again = await planUsualOrder(w.handlers, w.ctx('kitchen_agent'), v);
			expect(again.plan.id).toBe(placed.plan.id);
		}
	);
});
