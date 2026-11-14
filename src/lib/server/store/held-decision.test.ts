/**
 * Invariant: every held line belongs to exactly one decision, so a chef can always act on what waits for them. A line
 * nobody can approve (a fact gap: no price, not enough stock) is unorderable with its reasons, never held. Checked on
 * moment 2's vegetarian menu (real products) and the hotel's Christmas event.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type MenuProposal, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { decisionsOf } from '$lib/ui/decisions';
import { createDbPorts } from './db-ports';

const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});
const est = { source: 'llm' as const, ref: 'test' };
const ing = (dish: string, id: string, productId: string, amountPerCover: number) => ({
	id: `${dish}.${id}`,
	label: id,
	productId,
	amountPerCover,
	unit: 'g' as const,
	provenance: est
});

/** A no-meat dinner for 120 with a peach dessert, on the products moment 2 resolved to. */
const menu: MenuProposal = {
	id: 'm-veg',
	revision: 0,
	kitchenId: 'k-hotel',
	status: 'proposed',
	brief: {
		title: 'No-meat dinner for 120',
		date: '2026-12-12',
		guests: 120,
		serviceStyle: 'buffet',
		dietary: ['vegetarian'],
		provenance: { source: 'user' }
	},
	dishes: [
		{
			id: 'd-main',
			name: 'Mushroom risotto with halloumi',
			course: 'main',
			claimedCompatible: ['vegetarian'],
			ingredients: [
				ing('d-main', 'rice', '462302', 80),
				ing('d-main', 'mushroom', '475762', 60),
				ing('d-main', 'halloumi', '464123', 50),
				ing('d-main', 'tomato', '460027', 40)
			],
			provenance: est
		},
		{
			id: 'd-side',
			name: 'Roast roots',
			course: 'side',
			claimedCompatible: ['vegetarian'],
			ingredients: [ing('d-side', 'beet', '460769', 60), ing('d-side', 'carrot', '460819', 60)],
			provenance: est
		},
		{
			id: 'd-dessert',
			name: 'Peach compote with whipped cream',
			course: 'dessert',
			claimedCompatible: ['vegetarian'],
			ingredients: [
				ing('d-dessert', 'peach', '461196', 80),
				ing('d-dessert', 'cream', '469050', 30),
				ing('d-dessert', 'sugar', '465354', 10)
			],
			provenance: est
		}
	],
	open: [],
	provenance: est
};

function expectEveryHeldLineInOneDecision(plan: Plan, approval: Parameters<typeof decisionsOf>[1]) {
	const held = plan.lines.filter((l) => l.state === 'held').map((l) => l.id);
	const decisions = decisionsOf(plan, approval);
	const inDecisions = decisions.flatMap((d) => d.lineIds);
	// Exactly once each, and no decision line that isn't held.
	expect([...inDecisions].sort()).toEqual([...held].sort());
	expect(new Set(inDecisions).size).toBe(inDecisions.length);
	if (held.length) expect(decisions.length).toBeGreaterThan(0);
}

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	h = createHandlers(env.ports);
});

describe('every held line belongs to exactly one decision', () => {
	it('the vegetarian menu for 120 (moment 2)', async () => {
		await env.ports.menus!.put('ws-demo', menu);
		await env.ports.menus!.review(
			'ws-demo',
			'm-veg',
			0,
			{ kind: 'chef', id: 'chef-1' },
			new Date()
		);
		const r = await h.plan_event(ctx('chef'), {
			kitchenId: 'k-hotel',
			proposal: { id: 'm-veg', revision: 0 }
		});
		if (!r.ok) throw new Error(r.error.message);
		const got = await h.get_plan(ctx('chef'), { planId: r.value.plan.id });
		if (!got.ok) throw new Error(got.error.message);
		const { plan, approval } = got.value;
		expectEveryHeldLineInOneDecision(plan, approval as never);
		// Carrots and cream are vegetarian: no requirement keeps them out.
		for (const id of ['460819', '469050']) {
			const l = plan.lines.find((x) => x.productId === id);
			expect(l?.reasons ?? []).not.toContain('requirement_unmet');
		}
		// A fact gap is said on the line, never held without a decision.
		for (const l of plan.lines.filter((x) => x.reasons.includes('price_missing')))
			expect(l.state).toBe('unorderable');
	});

	it('the hotel Christmas event', async () => {
		const r = await h.plan_event(ctx('chef'), { kitchenId: 'k-hotel', eventId: 'event-xmas-140' });
		if (!r.ok) throw new Error(r.error.message);
		const got = await h.get_plan(ctx('chef'), { planId: r.value.plan.id });
		if (!got.ok) throw new Error(got.error.message);
		expectEveryHeldLineInOneDecision(got.value.plan, got.value.approval as never);
	});
});
