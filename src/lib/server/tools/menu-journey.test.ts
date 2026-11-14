/**
 * R12-08: the menu journey over MCP converges. An outside agent proposes a menu, revises one ingredient (every other
 * ingredient keeps its product), hands the human an absolute review link; the chef accepts that revision on their
 * own device; the agent plans it; held lines wait for the chef's approval; the agent commits once and gets one
 * receipt. The agent's door is the real MCP endpoint on a fixture key; the chef's acts are outside it (D17).
 */
import { describe, expect, it } from 'vitest';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createGetContext } from '../agent/get-context';
import { trialWorkspace } from '../agent/trial-harness';
import { acceptMenu } from '../menu/flow';
import { goldenBrief } from '../menu/golden';
import { reviseMenuHandler } from '../menu/tool';
import { createMcpEndpoint } from './mcp';

const ORIGIN = 'https://app.mandate.kitchen';

describe('R12-08: propose → revise → review → plan → approve → one receipt, over MCP', () => {
	it('converges, and a revision keeps every other pick', { timeout: 240_000 }, async () => {
		const w = await trialWorkspace();
		const handlers = {
			...w.handlers,
			get_context: createGetContext(w.env.ports),
			revise_menu: reviseMenuHandler({ ports: w.env.ports })
		} as ToolHandlers;
		const mcp = createMcpEndpoint(handlers, {
			env: {
				MANDATE_WORKSPACE: w.env.workspaceId,
				MANDATE_RUN: w.env.runId,
				PUBLIC_ORIGIN: ORIGIN
			},
			dev: true
		});
		let id = 0;
		async function call(name: string, args: unknown) {
			const res = await mcp(
				new Request('https://internal.aiven.app/mcp', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream',
						'mcp-protocol-version': '2025-06-18',
						authorization: 'Bearer fx-external-agent'
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: ++id,
						method: 'tools/call',
						params: { name, arguments: args }
					})
				})
			);
			const text = await res.text();
			const msg = JSON.parse(
				text.startsWith('{')
					? text
					: text
							.split('\n')
							.filter((l) => l.startsWith('data:'))
							.map((l) => l.slice(5))
							.pop()!
			);
			const r = msg.result;
			if (!r || r.isError)
				throw new Error(`${name}: ${r?.content?.[0]?.text ?? JSON.stringify(msg.error)}`);
			return r.structuredContent as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		}

		// The agent finds revise_menu in its tool list.
		const list = await mcp(
			new Request('https://internal.aiven.app/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-06-18',
					authorization: 'Bearer fx-external-agent'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} })
			})
		);
		expect(await list.text()).toContain('"revise_menu"');

		// 1. Propose.
		const p0 = await call('propose_menu', {
			kitchenId: 'k-hotel',
			brief: goldenBrief('christmas')
		});
		const proposalId: string = p0.proposal.id;
		expect(p0.meta.reviewUrl).toBe(
			`${ORIGIN}/request?menu=${encodeURIComponent(proposalId)}&rev=0`
		);
		const picks0 = new Map<string, string>(
			p0.proposal.dishes
				.flatMap((d: { ingredients: { id: string; productId?: string }[] }) => d.ingredients)
				.filter((i: { productId?: string }) => i.productId)
				.map((i: { id: string; productId: string }) => [i.id, i.productId])
		);
		expect(picks0.size).toBeGreaterThan(3);

		// 2. Revise one ingredient: pin another product the catalogue offers for it (the first ingredient that has one).
		const ingredients = p0.proposal.dishes.flatMap(
			(d: { ingredients: { id: string; label: string; productId?: string }[] }) => d.ingredients
		) as { id: string; label: string; productId?: string }[];
		let targetId = '';
		let other: string | undefined;
		for (const ing of ingredients.filter((i) => i.productId)) {
			const found = await w.env.ports.catalog.resolve!(ing.label, { limit: 5 });
			other =
				found.status === 'resolved'
					? found.candidates.map((c) => c.productId).find((x) => x !== ing.productId)
					: undefined;
			if (other) {
				targetId = ing.id;
				break;
			}
		}
		expect(other).toBeTruthy();
		const p1 = await call('revise_menu', {
			kitchenId: 'k-hotel',
			proposalId,
			revision: 0,
			changes: [{ kind: 'pin', ingredientId: targetId, productId: other }],
			reasoning: 'the chef prefers this one'
		});
		expect(p1.proposal.revision).toBe(1);
		expect(p1.meta.reviewUrl).toBe(
			`${ORIGIN}/request?menu=${encodeURIComponent(proposalId)}&rev=1`
		);
		const picks1 = new Map<string, string>(
			p1.proposal.dishes
				.flatMap((d: { ingredients: { id: string; productId?: string }[] }) => d.ingredients)
				.filter((i: { productId?: string }) => i.productId)
				.map((i: { id: string; productId: string }) => [i.id, i.productId])
		);
		expect(picks1.get(targetId)).toBe(other);
		// The point of revise over regenerate: every other ingredient keeps its product.
		for (const [ing, product] of picks0)
			if (ing !== targetId) expect(picks1.get(ing)).toBe(product);

		// 3. The chef accepts revision 1 on their own device (not a tool call).
		const accepted = await acceptMenu(
			{
				workspaceId: w.env.workspaceId,
				store: w.env.ports.menus!,
				catalog: w.env.ports.catalog,
				now: () => w.env.ports.clock.now()
			},
			{ id: proposalId, revision: 1, by: { kind: 'chef', id: 'chef-1' } }
		);
		expect(accepted.ok).toBe(true);

		// 4. The agent plans the accepted revision.
		const planned = await call('plan_event', {
			kitchenId: 'k-hotel',
			proposal: { id: proposalId, revision: 1 }
		});
		let plan = planned.plan;
		expect(plan.lines.length).toBeGreaterThan(0);

		// 5. Held lines wait for the chef, who approves on their device.
		const got = await call('get_plan', { planId: plan.id });
		plan = got.plan;
		if (got.approval?.state === 'pending') {
			expect(got.meta.approvalUrl).toMatch(new RegExp(`^${ORIGIN}/\\?kitchen=k-hotel&plan=`));
			const chef: CallContext = w.ctx('chef');
			const a = await w.handlers.approve(chef, {
				approvalId: got.approval.id,
				planVersion: got.approval.planVersion,
				termsHash: got.approval.termsHash,
				decision: 'grant'
			});
			expect(a.ok).toBe(true);
			plan = (await call('get_plan', { planId: plan.id })).plan;
		}

		// 6. One commit, one receipt; the same key again returns the same receipt.
		const key = `menu-journey-${proposalId}`;
		const c1 = await call('commit_order', {
			planId: plan.id,
			version: plan.version,
			idempotencyKey: key
		});
		const c2 = await call('commit_order', {
			planId: plan.id,
			version: plan.version,
			idempotencyKey: key
		});
		expect(c1.receiptId).toBeTruthy();
		expect(c1.committedLineIds.length).toBeGreaterThan(0);
		expect(c2.receiptId).toBe(c1.receiptId);
		const commits = w.ops.filter(
			(o) => o.op.type === 'CommitOrder' && o.op.outcome.result === 'committed'
		);
		expect(commits).toHaveLength(1);
		// The agent never granted anything.
		expect(
			w.ops.some(
				(o) =>
					o.op.type === 'RecordApproval' &&
					o.op.approval.state === 'granted' &&
					o.actor.kind !== 'chef'
			)
		).toBe(false);
	});
});
