/**
 * Cross-entry intent fidelity (evals/fidelity/cases.json): the same words through /request, the agent and a REST
 * place_order must give the same basket. Each path runs on its own fresh PGlite workspace with the real handlers and
 * the fixture parser/planner (no network). Checked as properties of the resulting plan (delivery date, physical
 * amount, constraint, product category), so a retrieval change can't rewrite the expectations. Known gaps are listed
 * per case in `expectFail` (finding id → result keys), as in the scenario evals.
 */
import { describe, expect, it } from 'vitest';
import type { Plan } from '$lib/core/contracts';
import { scenarioDate } from '$lib/core/scenario';
import { applyExpectFail } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { runGoal } from '../agent';
import { scriptedPlanner } from '../agent/loop';
import { trialWorkspace } from '../agent/trial-harness';
import { runRequest } from '../request/run';
import { cases, checkBasket, type Case } from './fidelity';

type Path = 'rest' | 'request' | 'agent';

async function playPath(c: Case, path: Path): Promise<{ plans: Plan[]; error?: string }> {
	const w = await trialWorkspace();
	const today = scenarioDate(w.env.ports.clock.now());
	try {
		if (path === 'rest') {
			const r = await w.handlers.place_order(w.ctx('kitchen_agent'), {
				kitchenId: c.kitchen,
				deliverBy: c.rest.deliverBy,
				idempotencyKey: `fidelity-${c.id}`,
				lines: c.rest.lines as never
			});
			if (!r.ok) return { plans: [], error: r.error.code };
		} else if (path === 'request') {
			const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
				(k) => k.id === c.kitchen
			)!;
			await runRequest(c.text, {
				handlers: w.handlers,
				ctx: w.ctx('kitchen_agent'),
				today,
				kitchen,
				llm: null,
				llmKind: 'fixture',
				place: true
			});
		} else {
			const run = await runGoal({
				goal: c.agentText ?? c.text,
				principal: w.principal({ kitchenIds: [c.kitchen], id: `fidelity-${c.id}` }),
				handlers: w.handlers,
				planner: scriptedPlanner(),
				source: { ...w.source, today: () => today }
			});
			const plans = Object.values((await w.state()).plans);
			return plans.length
				? { plans }
				: {
						plans,
						error: `agent stopped ${run.stopped}: ${run.summary.slice(0, 160)}`
					};
		}
	} catch (e) {
		return { plans: [], error: (e as Error).message.slice(0, 120) };
	}
	return { plans: Object.values((await w.state()).plans) };
}

describe('cross-entry intent fidelity', () => {
	for (const c of cases)
		it(c.id, { timeout: 120_000 }, async () => {
			const results: CheckResult[] = [];
			for (const path of ['rest', 'request', 'agent'] as const)
				results.push(...checkBasket(c, path, await playPath(c, path)));
			const final = applyExpectFail(results, c.expectFail);
			const failed = final.filter((r) => !r.pass);
			const known = final.filter((r) => r.detail.startsWith('expected-fail'));
			console.log(
				`${failed.length ? '✗' : '✓'} ${c.id} ${final.length - failed.length}/${final.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('') +
					known.map((r) => `\n    ~ ${r.key}: ${r.detail}`).join('')
			);
			expect(failed).toEqual([]);
		});
});
