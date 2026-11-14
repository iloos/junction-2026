import { describe, expect, it } from 'vitest';
import { plannedToolSchemas } from '$lib/core/contracts/tools-next';
import { createGetContext } from './get-context';
import { runGoal, scriptedPlanner } from './index';
import { trialWorkspace } from './trial-harness';

describe('get_context (F6)', () => {
	it(
		'a fresh client learns its kitchens, events and next call; the output matches the T0 schema',
		{
			timeout: 60_000
		},
		async () => {
			const w = await trialWorkspace();
			const handler = createGetContext(w.env.ports);
			const r = await handler(w.ctx('external_agent'), {});
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(plannedToolSchemas.get_context.output.safeParse(r.value).success).toBe(true);
			expect(r.value.scopes).not.toContain('approve');
			const hotel = r.value.kitchens.find((k) => k.id === 'k-hotel');
			expect(hotel?.events.map((e) => e.id)).toContain('event-xmas-140');
			expect(r.value.openPlans).toEqual([]);
			expect(r.value.meta?.nextAction).toMatchObject({
				tool: 'plan_event',
				args: { kitchenId: 'k-hotel', eventId: 'event-xmas-140' }
			});
			expect(w.ops).toHaveLength(0); // read-only
		}
	);

	it(
		'lists open plans with a next action and respects the kitchen grant',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			await runGoal({
				goal: 'Plan the Christmas buffet for 140 at k-hotel',
				principal: w.principal(),
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: w.source
			});
			const handler = createGetContext(w.env.ports);
			const r = await handler(w.ctx('chef'), {});
			if (!r.ok) throw new Error('get_context failed');
			expect(r.value.openPlans).toHaveLength(1);
			expect(r.value.openPlans[0].nextAction).toMatch(/held|find_substitutes|commit_order/);
			expect(r.value.meta?.nextAction?.tool).toBe('get_plan');
			const granted = await handler({ ...w.ctx('chef'), kitchenIds: ['k-lounas'] }, {});
			if (!granted.ok) throw new Error('get_context failed');
			expect(granted.value.kitchens.map((k) => k.id)).toEqual(['k-lounas']);
			expect(granted.value.openPlans).toEqual([]);
		}
	);
});
