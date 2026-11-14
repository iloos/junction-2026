import { describe, expect, it } from 'vitest';
import type { Task } from '$lib/core/contracts/task';
import type { TaskStore } from '$lib/core/ports';
import { runGoal } from '$lib/server/agent';
import { scriptedPlanner } from '$lib/server/agent/loop';
import { trialWorkspace } from '$lib/server/agent/trial-harness';
import { createFixtureDb } from '../db/pglite';
import { workspaces } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';
import { createGetOutcome } from './outcome';
import { drizzleTaskStore, memoryTaskStore } from './store';

const ADAPTERS: { name: string; make: () => Promise<TaskStore> }[] = [
	{ name: 'memory', make: async () => memoryTaskStore() },
	{
		name: 'postgres',
		make: async () => {
			const db = (await createFixtureDb()).db as unknown as AnyDb;
			await db
				.insert(workspaces)
				.values(['ws-a', 'ws-b'].map((id) => ({ id, name: id })))
				.onConflictDoNothing();
			return drizzleTaskStore(db);
		}
	}
];

const task = (ws = 'ws-a', id = 'task-1'): Task => ({
	workspaceId: ws,
	runId: 'r',
	id,
	kitchenId: 'k-hotel',
	title: '4 kg butter',
	createdBy: { kind: 'chef', id: 'c' },
	createdAt: '2026-12-07T19:40:00.000Z',
	updatedAt: '2026-12-07T19:40:00.000Z',
	version: 0,
	requirement: { kind: 'routine_order' },
	slots: {},
	plans: [],
	runs: [],
	pending: { kind: 'none' },
	state: 'open'
});

describe.each(ADAPTERS)('TaskStore ($name): compare-and-set on version', ({ make }) => {
	it('creates once, updates only from the version it read, scopes by workspace', async () => {
		const s = await make();
		const a = await s.put(task(), null);
		expect(a.ok && a.value.version).toBe(0);
		expect((await s.put(task(), null)).ok).toBe(false);
		const b = await s.put({ ...task(), state: 'running' }, 0);
		expect(b.ok && b.value.version).toBe(1);
		const lost = await s.put({ ...task(), state: 'done' }, 0);
		expect(lost.ok).toBe(false);
		if (!lost.ok) expect(lost.error.code).toBe('STALE_VERSION');
		expect((await s.get('ws-a', 'task-1'))?.state).toBe('running');
		expect(await s.get('ws-b', 'task-1')).toBeNull();
		await s.put(task('ws-a', 'task-2'), null);
		await s.put({ ...task('ws-a', 'task-2'), state: 'done' }, 0);
		expect((await s.list('ws-a', { open: true })).map((t) => t.id)).toEqual(['task-1']);
		expect(await s.list('ws-b')).toEqual([]);
	});
});

describe('get_outcome: the ledger from FulfilmentView, receipts and approvals', () => {
	it('a committed order: receipt and money match the store; a held one: one decision left', async () => {
		const w = await trialWorkspace();
		const getOutcome = createGetOutcome(w.env.ports, w.handlers);
		const chef = w.ctx('chef');
		const go = (goal: string, id: string) =>
			runGoal({
				goal,
				principal: w.principal({ id }),
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: w.source
			});
		const small = await go('Order 4 kg butter for k-lounas by Monday', 'agent-1');
		const big = await go('Order 400 kg butter for k-lounas by Monday', 'agent-2');
		const state = await w.state();

		const a = await getOutcome(chef, { planId: small.outcome!.planId! });
		expect(a.ok).toBe(true);
		if (!a.ok) return;
		const orders = Object.values(state.orders).filter((o) => o.planId === small.outcome!.planId);
		expect(a.value.ledger.committedCents).toBe(orders.reduce((s, o) => s + o.totalCents, 0));
		expect(a.value.ledger.receiptIds).toHaveLength(orders.length);
		expect(orders.length).toBe(1);
		expect(a.value.ledger.decisionsLeft).toBe(0);
		const plan = await w.handlers.get_plan(chef, { planId: small.outcome!.planId! });
		if (!plan.ok) throw new Error('plan');
		expect(a.value.ledger.needs.map((n) => n.required)).toEqual(
			plan.value.plan.view?.fulfilment.map((f) => f.required)
		);
		expect(a.value.meta?.summary).toMatch(/ordered for €/);

		const b = await getOutcome(chef, { planId: big.outcome!.planId! });
		if (!b.ok) throw new Error('outcome');
		expect(b.value.ledger.receiptIds).toEqual([]);
		expect(b.value.ledger.decisionsLeft).toBeGreaterThan(0);
		expect(b.value.meta?.summary).toMatch(/nothing ordered yet/);
		expect(b.value.meta?.summary).not.toMatch(/supplier confirmed/);

		expect((await getOutcome(chef, { planId: 'nope' })).ok).toBe(false);
		expect(
			(await getOutcome({ ...chef, kitchenIds: ['k-hotel'] }, { planId: big.outcome!.planId! })).ok
		).toBe(false);
	}, 120_000);
});
