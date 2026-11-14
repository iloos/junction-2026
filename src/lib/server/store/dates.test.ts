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

	it('dates a quote without deliverBy for the scenario delivery, with its cut-off still ahead', async () => {
		const env = await createDbPorts();
		const h = createHandlers(env.ports);
		const r = await h.quote(chef, { productIds: ['464201', '462157'] });
		if (!r.ok) throw new Error(r.error.message);
		for (const o of r.value.offers) {
			if (!o.availability.closingTime) continue;
			expect(o.availability.provenance.note).toMatch(/^scenario dates/);
			expect(new Date(o.availability.closingTime).getTime()).toBeGreaterThan(
				env.ports.clock.now().getTime()
			);
		}
		expect(r.value.offers[0].availability.availableDate).toBe(SCENARIO.delivery);
	});

	it('re-dates every offers call, even one that names no delivery date', async () => {
		const env = await createDbPorts();
		// The port requires deliverBy; an untyped caller (a script, a JS client) can still omit it.
		const { offers } = await env.ports.catalog.offers(['464201'], undefined as unknown as string);
		expect(offers[0].availability.availableDate).toBe(SCENARIO.delivery);
		expect(offers[0].availability.closingTime?.startsWith('2026-12-')).toBe(true);
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
