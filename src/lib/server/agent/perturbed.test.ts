/**
 * Suite: agent goal trials · r6-5 perturbed requirement (evals/scenarios/r6-5 on lane/f-evals), played by the
 * scripted policy: the agent plans the buffet and rescues the ham, a chef approves, then the chef's agent
 * raises cured salmon to 160 g per guest. Only the salmon resizes, the ham rescue stays, the approval is
 * voided and a new one waits, and the dishes without supplier cover stay open in the outcome.
 */
import { describe, expect, it } from 'vitest';
import { runGoal, scriptedPlanner } from './index';
import { matchNeed } from './loop';
import { trialWorkspace } from './trial-harness';
import type { PlanFacts } from './facts';

describe('suite: agent goal trials · r6-5 perturbed requirement', () => {
	it(
		'salmon to 160 g/guest mid-plan: resized, rescue kept, approval voided, residuals open',
		{
			timeout: 90_000
		},
		async () => {
			const w = await trialWorkspace();
			const play = (goal: string, id: string) =>
				runGoal({
					goal,
					principal: w.principal({ id }),
					handlers: w.handlers,
					planner: scriptedPlanner(),
					source: w.source
				});
			await play('Plan the Christmas buffet for 140 at k-hotel', 'agent-r65-plan');
			let st = await w.state();
			const before = Object.values(st.plans)[0];
			expect(before.lines.find((l) => l.productId === '462150')?.qty).toMatchObject({ value: 20 });
			const ap = Object.values(st.approvals).find((a) => a.state === 'pending')!;
			const granted = await w.handlers.approve(w.ctx('approver'), {
				approvalId: ap.id,
				planVersion: ap.planVersion,
				termsHash: ap.termsHash,
				decision: 'grant'
			});
			expect(granted.ok).toBe(true);

			const opsBefore = w.ops.length;
			const run = await play('Raise the cured salmon to 160 g per guest', 'agent-r65-edit');
			expect(run.outcome?.intent).toBe('adjust_need');
			expect(run.steps.map((s) => s.tool)).toEqual(['get_plan', 'edit_line']);
			st = await w.state();
			const plan = st.plans[before.id];
			// 140 × 160 g = 22.4 kg → 30 kg in 10 kg lots.
			expect(plan.lines.find((l) => l.productId === '462150')?.qty).toMatchObject({
				value: 30,
				unit: 'KG'
			});
			// The ham rescue stays as it was.
			expect(plan.lines.find((l) => l.productId === '476768')).toMatchObject({
				qty: { value: 13, unit: 'ST' },
				substituteFor: '462490'
			});
			// The chef's grant is voided by the change; a new approval waits for the new terms.
			expect(st.approvals[ap.id].state).toBe('invalidated');
			expect(run.outcome).toMatchObject({ status: 'awaiting_user' });
			expect(run.outcome?.approvalIds).toHaveLength(1);
			expect(run.outcome?.approvalIds[0]).not.toBe(ap.id);
			// Dishes nothing in the catalogue covers stay open: never confirmed.
			const confirmed = run.outcome!.confirmedNeeds.map((n) => n.needId);
			expect(confirmed).not.toContain('need:lanttulaatikko');
			expect(confirmed).not.toContain('need:joulutorttu');
			// Only the agent wrote, for the chef who started it.
			for (const op of w.ops.slice(opsBefore))
				expect(op.actor).toEqual({ kind: 'kitchen_agent', id: 'routine-agent' });
		}
	);

	it('a dish the plan does not have, or an ambiguous one, is not guessed', () => {
		const plan = {
			id: 'pl',
			needs: [
				{ id: 'n1', label: 'Sinappisilli (mustard herring)' },
				{ id: 'n2', label: 'Tomaattisilli (tomato herring)' }
			]
		} as unknown as PlanFacts;
		expect(matchNeed(plan, 'herring').why).toMatch(/could be .* or .*name the dish/);
		expect(matchNeed(plan, 'mustard herring')).toMatchObject({ id: 'n1' });
		expect(matchNeed(plan, 'lobster').why).toMatch(/no dish/);
	});
});
