/**
 * The run fence (R9-08): under the workspace lock a write belongs to the current run or is refused, whether the
 * caller's context predates a reset or another instance reset the workspace without this process knowing.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import * as schema from '../db/schema';
import { currentRun } from '../demo/run';
import { createDbPorts } from './db-ports';

const ctx = (workspaceId: string, runId: string): CallContext => ({
	workspaceId,
	runId,
	actor: { kind: 'kitchen_agent', id: 'agent-1' },
	scopes: SCOPES_BY_ACTOR.kitchen_agent,
	via: 'test'
});
const order = (key: string) => ({
	kitchenId: 'k-hotel',
	deliverBy: '2026-12-10',
	idempotencyKey: key,
	lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
});

describe('run fence', () => {
	it('refuses a write from a context on a run that is not current', async () => {
		const b = await createDbPorts();
		const h = createHandlers(b.ports);
		const r = await h.place_order(ctx(b.workspaceId, 'run-old'), order('stale'));
		expect(r.ok ? null : r.error).toMatchObject({ code: 'STALE_VERSION', sub: 'run' });
		expect(Object.keys((await b.store.load(b.workspaceId, 'run-old')).plans)).toEqual([]);
		expect((await h.place_order(ctx(b.workspaceId, 'run-1'), order('fresh'))).ok).toBe(true);
	});

	it('refuses when another instance started a newer run, then follows it', async () => {
		const ws = `ws-fence-${Date.now().toString(36)}`;
		const b = await createDbPorts({ workspaceId: ws, followCurrentRun: true });
		const h = createHandlers(b.ports);
		const before = currentRun(ws);
		// Another instance resets the workspace: a newer run row this process has not heard of.
		await b.db.insert(schema.runs).values({
			id: `${before}-next`,
			workspaceId: ws,
			label: 'reset elsewhere',
			simStart: new Date('2026-12-07T19:40:00Z'),
			createdAt: new Date(Date.now() + 60_000)
		});
		const stale = await h.place_order(ctx(ws, before), order('old-run'));
		expect(stale.ok ? null : stale.error).toMatchObject({ code: 'STALE_VERSION', sub: 'run' });
		// The refusal refreshed this process: the next call on the new run goes through.
		expect(currentRun(ws)).toBe(`${before}-next`);
		const next = await h.place_order(ctx(ws, currentRun(ws)), order('new-run'));
		expect(next.ok).toBe(true);
	});
});
