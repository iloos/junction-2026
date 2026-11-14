import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { realHandlers } from '$lib/server/tools/handlers';
import { serveTool } from '$lib/server/tools/serve';
import { ensureRunLoaded, onCurrentRun } from './reset';
import { SCENARIO } from '$lib/core/scenario';
import { createServerPorts } from '$lib/server/store/server-ports';
import { loadSeedKitchens } from '$lib/server/store/db-ports';
import { newRunId, setCurrentRun } from './run';
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

describe('onCurrentRun', () => {
	afterEach(() => vi.useRealTimers());

	it('moves a key context onto a run another process started, within the refresh window', async () => {
		const ws = newVisitorWorkspace();
		const runA = await ensureRunLoaded(ws, { start: true });
		const ctx = contextFor('kitchen_agent', 't', 'test', {}, ws);
		expect(ctx.runId).toBe(runA);

		// Another process resets the sandbox: a newer runs row this process has not set current.
		await realHandlers();
		const { store } = await createServerPorts();
		const runB = newRunId(Date.now() + 1000);
		await store.ensure({
			workspaceId: ws,
			runId: runB,
			kitchens: loadSeedKitchens(),
			simStart: SCENARIO.start
		});

		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 6_000);
		const moved = await onCurrentRun(ctx);
		expect(moved.runId).toBe(runB);
		// A pinned run (MANDATE_RUN) is left alone.
		expect((await onCurrentRun(ctx, 'run-pinned')).runId).toBe(runA);
	}, 60_000);

	it('R9-08: a context on an old run moves to the run this process already knows', async () => {
		const ws = newVisitorWorkspace();
		setCurrentRun(ws, 'run-new');
		const ctx = { ...contextFor('external_agent', 'review', 'review', {}, ws), runId: 'run-old' };
		expect((await onCurrentRun(ctx)).runId).toBe('run-new');
	});

	it('keeps an explicit run in a workspace with no runs row', async () => {
		const ctx = {
			...contextFor('kitchen_agent', 't', 'test', {}, 'ws-test-norun'),
			runId: 'run-x'
		};
		expect((await onCurrentRun(ctx)).runId).toBe('run-x');
	});
});
