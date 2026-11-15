/**
 * get_plan for an agent's context: a held event plan is ~60 KB, mostly Valio's raw stock payloads and offer
 * provenance. `brief: true` leaves those out; every line, state, price, stock kind and view stays.
 */
import { describe, expect, it } from 'vitest';
import { toolSchemas } from '$lib/core/contracts';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';

describe('get_plan brief', () => {
	it(
		'drops raw payloads and offer provenance, keeps every line, state and price',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			w.env.ports.clock = { now: () => FIDELITY_NOW };
			const ctx = w.ctx('external_agent');
			const planned = await w.handlers.plan_event(ctx, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const planId = planned.value.plan.id;
			const full = await w.handlers.get_plan(ctx, { planId });
			const brief = await w.handlers.get_plan(ctx, { planId, brief: true });
			if (!full.ok || !brief.ok) throw new Error('get_plan failed');
			expect(() => toolSchemas.get_plan.output.parse(brief.value)).not.toThrow();
			const a = full.value.plan.lines;
			const b = brief.value.plan.lines;
			expect(b.map((l) => [l.id, l.state, l.lineCents, l.offer?.price?.unitCents])).toEqual(
				a.map((l) => [l.id, l.state, l.lineCents, l.offer?.price?.unitCents])
			);
			expect(b.map((l) => l.offer?.availability.kind)).toEqual(
				a.map((l) => l.offer?.availability.kind)
			);
			const json = JSON.stringify(brief.value);
			expect(json).not.toContain('scheduleLines');
			expect(json.length).toBeLessThan(JSON.stringify(full.value).length * 0.8);
		}
	);
});
