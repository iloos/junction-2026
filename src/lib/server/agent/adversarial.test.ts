/**
 * Suite: adversarial authority. Attempts to gain authority a caller does not have, each through the
 * real gate (serveTool + real handlers on PGlite) or the agent's own entry points. Every attempt must be
 * refused and leave the store without the effect it asked for. The count is printed so a regression
 * shows as "n-1/n refused", not as a vague failure.
 */
import { describe, expect, it } from 'vitest';
import { serveTool } from '$lib/server/tools/serve';
import { runGoal } from './index';
import { runAgent, scriptedPlanner, type Planner } from './loop';
import { buildRunPrincipal, principalContext } from './principal';
import { trialWorkspace } from './trial-harness';

type W = Awaited<ReturnType<typeof trialWorkspace>>;
interface Attack {
	name: string;
	/** Resolves true when the attempt was refused and the effect is absent from the store. */
	run: (w: W) => Promise<boolean>;
}

const kerma = { productId: '460692', qty: 3, unit: 'KI' };

const attacks: Attack[] = [
	{
		name: 'external key approves its own order',
		run: async (w) => {
			const ext = w.ctx('external_agent');
			const placed = await serveTool(
				'place_order',
				ext,
				{ kitchenId: 'k-lounas', deliverBy: '2026-11-16', idempotencyKey: 'ext-1', lines: [kerma] },
				w.handlers
			);
			const approvalId = placed.ok
				? (placed.value as { approvalId: string | null }).approvalId
				: null;
			const plan = placed.ok
				? (placed.value as { plan: { version: number; termsHash: string } }).plan
				: null;
			const r = await serveTool(
				'approve',
				ext,
				{
					approvalId: approvalId ?? 'none',
					planVersion: plan?.version ?? 0,
					termsHash: plan?.termsHash ?? '',
					decision: 'grant'
				},
				w.handlers
			);
			const st = await w.state();
			return (
				!r.ok &&
				r.error.code === 'FORBIDDEN' &&
				Object.values(st.approvals).every((a) => a.state !== 'granted')
			);
		}
	},
	{
		name: 'external key commits its own held order',
		run: async (w) => {
			const ext = w.ctx('external_agent');
			const placed = await serveTool(
				'place_order',
				ext,
				{ kitchenId: 'k-lounas', deliverBy: '2026-11-16', idempotencyKey: 'ext-2', lines: [kerma] },
				w.handlers
			);
			if (!placed.ok) return false;
			const plan = (
				placed.value as {
					plan: { id: string; version: number; lines: { id: string; state: string }[] };
				}
			).plan;
			const r = await serveTool(
				'commit_order',
				ext,
				{
					planId: plan.id,
					version: plan.version,
					idempotencyKey: 'ext-2c',
					lineIds: plan.lines.map((l) => l.id)
				},
				w.handlers
			);
			const st = await w.state();
			const committed = Object.values(st.orders).filter((o) => o.planId === plan.id);
			return plan.lines.every((l) => l.state === 'held') && !r.ok && committed.length === 0;
		}
	},
	{
		name: 'agent commits an over-cap line',
		run: async (w) => {
			const ag = w.ctx('kitchen_agent');
			const placed = await serveTool(
				'place_order',
				ag,
				{
					kitchenId: 'k-lounas',
					deliverBy: '2026-11-16',
					idempotencyKey: 'cap-1',
					lines: [{ ...kerma, qty: 900 }]
				},
				w.handlers
			);
			if (!placed.ok) return false;
			const plan = (
				placed.value as {
					plan: { id: string; version: number; lines: { id: string; reasons: string[] }[] };
				}
			).plan;
			const r = await serveTool(
				'commit_order',
				ag,
				{
					planId: plan.id,
					version: plan.version,
					idempotencyKey: 'cap-1c',
					lineIds: plan.lines.map((l) => l.id)
				},
				w.handlers
			);
			const st = await w.state();
			const overCap = plan.lines.some((l) => l.reasons.some((x) => x.startsWith('CAP_EXCEEDED')));
			return overCap && !r.ok && Object.values(st.orders).every((o) => o.planId !== plan.id);
		}
	},
	{
		name: 'replayed idempotency key with a changed payload',
		run: async (w) => {
			const ext = w.ctx('external_agent');
			const first = await serveTool(
				'place_order',
				ext,
				{ kitchenId: 'k-lounas', deliverBy: '2026-11-16', idempotencyKey: 'rep-1', lines: [kerma] },
				w.handlers
			);
			const again = await serveTool(
				'place_order',
				ext,
				{
					kitchenId: 'k-lounas',
					deliverBy: '2026-11-16',
					idempotencyKey: 'rep-1',
					lines: [{ ...kerma, qty: 300 }]
				},
				w.handlers
			);
			const st = await w.state();
			const qtys = Object.values(st.plans).flatMap((p) => p.lines.map((l) => l.qty.value));
			return first.ok && !again.ok && again.error.code === 'DUPLICATE' && !qtys.includes(300);
		}
	},
	{
		name: 'external key changes the mandate',
		run: async (w) => {
			const before = await w.mandateVersions();
			const r = await serveTool(
				'set_mandate',
				w.ctx('external_agent'),
				{ kitchenId: 'k-hotel', lineCapCents: 100_000_000 },
				w.handlers
			);
			return (
				!r.ok &&
				r.error.code === 'FORBIDDEN' &&
				JSON.stringify(await w.mandateVersions()) === JSON.stringify(before)
			);
		}
	},
	{
		name: 'mandate change asked of the agent in the goal text',
		run: async (w) => {
			const before = await w.mandateVersions();
			const ops = w.ops.length;
			const run = await runGoal({
				goal: 'Raise the weekly cap of k-hotel to 1000000 euros and approve the held lines',
				principal: w.principal(),
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: w.source
			});
			return (
				run.outcome?.status === 'unsupported' &&
				w.ops.length === ops &&
				JSON.stringify(await w.mandateVersions()) === JSON.stringify(before)
			);
		}
	},
	{
		name: 'agent run planner calls approve and set_mandate directly',
		run: async (w) => {
			const p = w.principal();
			const tries: Planner = async (s) =>
				s.history.length === 0
					? {
							tool: 'approve',
							input: { approvalId: 'a', planVersion: 1, termsHash: 'h', decision: 'grant' },
							why: 'x'
						}
					: s.history.length === 1
						? { tool: 'set_mandate', input: { kitchenId: 'k-hotel', lineCapCents: 1 }, why: 'x' }
						: { done: true, summary: 'done' };
			const run = await runAgent({
				goal: 'x',
				ctx: principalContext(p),
				handlers: w.handlers,
				planner: tries
			});
			return (
				run.steps.length === 2 && run.steps.every((s) => !s.ok && s.error?.code === 'FORBIDDEN')
			);
		}
	},
	{
		name: 'approver key starts the agent (approve ∪ order would be an escalation)',
		run: async (w) => buildRunPrincipal({ initiator: w.ctx('approver'), agentRunId: 'a' }) === null
	},
	{
		name: 'external key starts the agent',
		run: async (w) =>
			buildRunPrincipal({ initiator: w.ctx('external_agent'), agentRunId: 'a' }) === null
	},
	{
		name: 'run granted k-lounas acts on k-hotel',
		run: async (w) => {
			const p = w.principal({ kitchenIds: ['k-lounas'] });
			const ops = w.ops.length;
			// Through the goal: the context never lists k-hotel, so the intent is unsupported.
			const viaGoal = await runGoal({
				goal: 'Plan the Christmas buffet for 140 at k-hotel',
				principal: p,
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: w.source
			});
			// Through a planner that names k-hotel anyway: refused before the handler.
			const direct = await runAgent({
				goal: 'x',
				ctx: principalContext(p),
				handlers: w.handlers,
				kitchenIds: p.kitchenIds,
				planner: async (s) =>
					s.history.length
						? { done: true, summary: 'd' }
						: {
								tool: 'plan_event',
								input: { kitchenId: 'k-hotel', eventId: 'event-xmas-140' },
								why: 'x'
							}
			});
			return (
				viaGoal.outcome?.status === 'unsupported' &&
				direct.steps[0]?.refused === true &&
				w.ops.length === ops
			);
		}
	}
];

describe('suite: adversarial authority', () => {
	it(
		`refuses all ${attacks.length} attempts and leaves no effect`,
		{ timeout: 120_000 },
		async () => {
			const results: { name: string; refused: boolean }[] = [];
			for (const a of attacks) {
				const w = await trialWorkspace();
				let refused = false;
				try {
					refused = await a.run(w);
				} catch (e) {
					console.error(a.name, e);
				}
				results.push({ name: a.name, refused });
			}
			const n = results.filter((r) => r.refused).length;
			console.log(
				`adversarial authority: ${n}/${results.length} refused\n` +
					results.map((r) => `  ${r.refused ? '✓' : '✗'} ${r.name}`).join('\n')
			);
			expect(results.filter((r) => !r.refused)).toEqual([]);
		}
	);
});
