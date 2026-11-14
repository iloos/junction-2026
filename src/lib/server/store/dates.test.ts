/** Prod rehearsal P1: a December story never shows the November cut-offs of the cached Valio data. */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const chef = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef' as const, id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};

describe('quotes on the scenario clock', () => {
	it('dates a quote for the scenario delivery in December', async () => {
		const env = await createDbPorts();
		const h = createHandlers(env.ports);
		const r = await h.quote(
			{
				workspaceId: 'ws-demo',
				runId: 'run-1',
				actor: { kind: 'chef', id: 'chef-1' },
				scopes: SCOPES_BY_ACTOR.chef,
				via: 'test'
			},
			{ productIds: ['464201'], deliverBy: SCENARIO.delivery }
		);
		if (!r.ok) throw new Error(r.error.message);
		const a = r.value.offers[0].availability;
		expect(a.availableDate).toBe(SCENARIO.delivery);
		expect(a.closingTime?.startsWith('2026-12-09T')).toBe(true); // Stock: the day before
		expect(a.provenance.note).toMatch(/^scenario dates/);
	});

	it('has the story cut-off at the earliest cut-off of the event lines, after the scenario start', async () => {
		const env = await createDbPorts();
		const h = createHandlers(env.ports);
		const r = await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
		if (!r.ok) throw new Error(r.error.message);
		const cutoffs = r.value.plan.lines
			.map((l) => l.offer?.availability.closingTime)
			.filter((c): c is string => Boolean(c))
			.map((c) => new Date(c).getTime());
		expect(cutoffs.length).toBeGreaterThan(0);
		expect(Math.min(...cutoffs)).toBe(new Date(SCENARIO.cutoff).getTime());
		expect(Math.min(...cutoffs)).toBeGreaterThan(new Date(SCENARIO.start).getTime());
	});
});
