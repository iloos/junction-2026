import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from './db-ports';

const chef: CallContext = {
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'chef', id: 'chef-1' },
	scopes: SCOPES_BY_ACTOR.chef,
	via: 'test'
};
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

let h: ToolHandlers;
beforeEach(async () => {
	const env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

describe('plan_event: Christmas buffet for 140 (s2)', () => {
	it('expands the seed into pack-rounded lines with real outages and unknown supply flagged', async () => {
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const by = (id: string) => plan.lines.find((l) => l.productId === id)!;
		expect(plan).toMatchObject({ deliverBy: '2026-12-11', eventId: 'event-xmas-140' });
		expect(plan.lines).toHaveLength(13);
		expect(by('462150').qty).toMatchObject({ value: 20, unit: 'KG' });
		expect(by('463876').qty).toMatchObject({ value: 2, unit: 'ST' });
		expect(by('475214').qty).toMatchObject({ value: 2, unit: 'ST' });
		expect(by('466964').qty).toMatchObject({ value: 2, unit: 'BAG' });
		expect(by('464201').qty).toMatchObject({ value: 11, unit: 'ST' });
		for (const id of ['463860', '461210', '462455']) {
			expect(by(id)).toMatchObject({ state: 'held' });
			expect(by(id).reasons).toContain('UNKNOWN_REQUIRED');
		}
		expect(by('462490')).toMatchObject({
			state: 'unorderable',
			reasons: ['out'],
			qty: { value: 28, unit: 'KG' }
		});
		expect(by('462482')).toMatchObject({
			state: 'unorderable',
			reasons: ['out'],
			qty: { value: 8 }
		});
		expect(by('473317')).toMatchObject({ state: 'unorderable', reasons: ['undeliverable'] });
		expect(plan.state).toBe('held');

		const again = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		expect(again.plan.version).toBe(plan.version); // planning again is a read, not a second plan
	});

	it('recomputes the ham need on a g/guest edit: the 7 kg lot absorbs it', async () => {
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const t0 = performance.now();
		const edited = must(
			await h.edit_line(chef, {
				planId: plan.id,
				version: plan.version,
				needId: 'need:joulukinkku',
				patch: { gramsPerGuest: 120 }
			})
		).plan;
		const ms = performance.now() - t0;
		const ham = edited.lines.find((l) => l.productId === '462490')!;
		expect(edited.needs.find((n) => n.id === 'need:joulukinkku')!.amount.value).toBeCloseTo(24, 2);
		expect(ham.qty).toMatchObject({ value: 28, unit: 'KG' });
		expect(edited.version).toBe(plan.version + 2); // EditLine + RecordOffer
		expect(ms).toBeLessThan(1000);

		const view = must(await h.get_plan(chef, { planId: plan.id }));
		expect(view.approval).toMatchObject({ state: 'pending', planVersion: edited.version });
	});

	it('explains a line step by step with sources', async () => {
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		const salmon = plan.lines.find((l) => l.productId === '462150')!;
		const { steps } = must(await h.explain_line(chef, { planId: plan.id, lineId: salmon.id }));
		const text = steps.map((s) => s.text);
		expect(text[0]).toContain('Graavilohi');
		expect(text).toEqual(
			expect.arrayContaining([
				'70 g/guest served',
				'× 140 guests',
				'÷ yield 0.85',
				'€14.11 per KG → €282.20'
			])
		);
		expect(text.some((t) => t.includes('2 × 10 kg lot = 20 kg'))).toBe(true);
		expect(steps.length).toBeGreaterThanOrEqual(7);
	});
});
