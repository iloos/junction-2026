import { describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { realHandlers } from '$lib/server/tools/handlers';
import { serveTool } from '$lib/server/tools/serve';
import { ensureRunLoaded } from './reset';
import { resetSandbox } from './sandbox';
import { newVisitorWorkspace } from './visitor-id';

const order = {
	kitchenId: 'k-lounas',
	deliverBy: '2026-12-09',
	idempotencyKey: 'milk-1',
	lines: [{ productId: '460692', qty: 3, unit: 'KI' }]
};

describe('reset and idempotency', () => {
	it('a retried key after a reset places a fresh order in the new run, not a replay of the old one', async () => {
		const ws = newVisitorWorkspace();
		const runA = await ensureRunLoaded(ws, { start: true });
		const h = await realHandlers();
		const a = await serveTool(
			'place_order',
			contextFor('kitchen_agent', 't', 'test', {}, ws),
			order,
			h
		);
		expect(a.ok).toBe(true);
		const planA = a.ok ? (a.value as { plan: { id: string } }).plan.id : '';
		expect(planA).toContain(runA);

		const r = await resetSandbox(ws);
		expect(r.ok).toBe(true);
		const runB = r.ok ? r.runId : '';
		const b = await serveTool(
			'place_order',
			contextFor('kitchen_agent', 't', 'test', {}, ws),
			order,
			h
		);
		expect(b.ok).toBe(true);
		const planB = b.ok ? (b.value as { plan: { id: string } }).plan.id : '';
		expect(planB).toContain(runB);
		expect(planB).not.toBe(planA);
		// And it is findable in the new run.
		const got = await serveTool(
			'get_plan',
			contextFor('kitchen_agent', 't', 'test', {}, ws),
			{ planId: planB },
			h
		);
		expect(got.ok).toBe(true);
	}, 60_000);
});
