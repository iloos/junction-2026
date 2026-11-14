/**
 * A4: plan_event{proposal} plans only a revision the server's review record covers, one need per dish ingredient
 * with lineage, lines sized to the pinned product, unresolved ingredients kept as visible needs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type MenuProposal } from '$lib/core/contracts';
import { menuDemand } from '$lib/core/demand';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { planEvent } from '$lib/core/services/events';
import { createDbPorts } from './db-ports';

const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});
const SALMON = '462150';
const est = { source: 'llm' as const, ref: 'test' };

const proposal = (revision = 0): MenuProposal => ({
	id: 'm-test',
	revision,
	kitchenId: 'k-hotel',
	status: 'proposed',
	brief: {
		title: 'Dinner for 60',
		date: '2026-12-12',
		guests: 60,
		serviceStyle: 'buffet',
		dietary: ['lactose-free'],
		provenance: { source: 'user' }
	},
	dishes: [
		{
			id: 'd-soup',
			name: 'Lohikeitto',
			course: 'soup',
			claimedCompatible: ['lactose-free'],
			ingredients: [
				{
					id: 'd-soup.lohi',
					label: 'Lohi',
					productId: SALMON,
					amountPerCover: 80,
					unit: 'g',
					yield: 0.8,
					provenance: est
				},
				{
					id: 'd-soup.tilli',
					label: 'Tilli',
					unresolved: 'no fresh dill in the catalogue',
					amountPerCover: 2,
					unit: 'g',
					provenance: est
				}
			],
			provenance: est
		}
	],
	open: [],
	provenance: est
});

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	h = createHandlers(env.ports);
	await env.ports.menus!.put('ws-demo', proposal());
});

const plan = () =>
	h.plan_event(ctx('chef'), { kitchenId: 'k-hotel', proposal: { id: 'm-test', revision: 0 } });

describe('menu demand (pure)', () => {
	it('derives one need per ingredient with lineage and the formula, assuming yield 1 out loud', () => {
		const [lohi, tilli] = menuDemand({ ...proposal(), status: 'chef_reviewed' });
		expect(lohi.need).toMatchObject({
			id: 'd-soup.lohi',
			kind: 'dish',
			source: { proposalId: 'm-test', revision: 0, dishId: 'd-soup', ingredientId: 'd-soup.lohi' },
			amount: { value: 6, unit: 'kg' }
		});
		expect(lohi.need.dish?.formula).toBe('80 g × 60 ÷ 0.8 = 6 kg');
		expect(tilli.need.unresolved).toBe('no fresh dill in the catalogue');
		expect(tilli.need.dish?.formula).toContain('yield 1 assumed');
	});
});

describe('plan_event{proposal}', () => {
	it('refuses a revision with no review record', async () => {
		const r = await plan();
		expect(r.ok ? null : r.error).toMatchObject({ code: 'FORBIDDEN', sub: 'review_required' });
	});

	it('plans a reviewed revision: lineage, sized buy line, the unresolved ingredient kept visible', async () => {
		await env.ports.menus!.review(
			'ws-demo',
			'm-test',
			0,
			{ kind: 'chef', id: 'chef-1' },
			new Date()
		);
		const r = await plan();
		if (!r.ok) throw new Error(r.error.message);
		const p = r.value.plan;
		expect(p.source).toEqual({ proposalId: 'm-test', revision: 0 });
		expect(p.needs.map((n) => n.id)).toEqual(['d-soup.lohi', 'd-soup.tilli']);
		expect(p.needs[1].unresolved).toBeTruthy();
		expect(p.lines).toHaveLength(1);
		expect(p.lines[0]).toMatchObject({
			needId: 'd-soup.lohi',
			productId: SALMON,
			strategy: { id: 'd-soup.lohi:buy', kind: 'buy' },
			provenance: { source: 'llm' }
		});
		expect(p.lines[0].qty.value).toBeGreaterThanOrEqual(6);
		// Planning the same revision again is a read.
		const again = await plan();
		expect(again.ok && again.value.plan.id).toBe(p.id);
	});

	it('carries the procurement task when one asked for the plan', async () => {
		await env.ports.menus!.review(
			'ws-demo',
			'm-test',
			0,
			{ kind: 'chef', id: 'chef-1' },
			new Date()
		);
		const r = await planEvent(
			env.ports,
			ctx('chef'),
			{ kitchenId: 'k-hotel', proposal: { id: 'm-test', revision: 0 } },
			{ taskId: 'task-1' }
		);
		expect(r.ok && r.value.plan.taskId).toBe('task-1');
	});

	it('an amount edit by ingredient re-sizes only that need', async () => {
		await env.ports.menus!.review(
			'ws-demo',
			'm-test',
			0,
			{ kind: 'chef', id: 'chef-1' },
			new Date()
		);
		const p = (await plan()) as { ok: true; value: { plan: { id: string; version: number } } };
		const r = await h.edit_line(ctx('chef'), {
			planId: p.value.plan.id,
			version: p.value.plan.version,
			needId: 'd-soup.lohi',
			patch: { gramsPerGuest: 200 }
		});
		if (!r.ok) throw new Error(r.error.message);
		const need = r.value.plan.needs.find((n) => n.id === 'd-soup.lohi')!;
		expect(need.amount).toEqual({ value: 15, unit: 'kg' });
		expect(need.dish).toMatchObject({ gServed: 200, defaultGServed: 80 });
		expect(need.provenance.source).toBe('user');
		expect(r.value.plan.lines[0].qty.value).toBeGreaterThanOrEqual(15);
	});
});
