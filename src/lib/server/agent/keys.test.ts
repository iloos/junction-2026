import { describe, expect, it } from 'vitest';
import { runGoal } from './index';
import { scriptedPlanner, type Planner } from './loop';
import { trialWorkspace } from './trial-harness';

describe('suite: agent goal trials · server-owned idempotency keys', () => {
	it(
		'a model that mints its own keys still gets one plan and one receipt for the same request',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			const script = scriptedPlanner();
			let n = 0;
			// Plays the script but, like a model, sends a fresh key of its own on every order-writing call.
			const model: Planner = async (s, signal) => {
				const a = await script(s, signal);
				if ('tool' in a && (a.tool === 'place_order' || a.tool === 'commit_order'))
					return { ...a, input: { ...(a.input as object), idempotencyKey: `model-${n++}` } };
				return a;
			};
			const go = (id: string) =>
				runGoal({
					goal: 'Order 4 kg butter for k-lounas by Monday',
					principal: w.principal({ id }),
					handlers: w.handlers,
					planner: model,
					source: w.source
				});
			const a = await go('agent-k1');
			const b = await go('agent-k2');
			expect(n).toBeGreaterThanOrEqual(2);
			const sent = [...a.steps, ...b.steps]
				.filter((x) => x.tool === 'place_order' || x.tool === 'commit_order')
				.map((x) => (x.input as { idempotencyKey: string }).idempotencyKey);
			expect(sent.every((k) => k.startsWith('agent:'))).toBe(true);
			const s = await w.state();
			expect(Object.keys(s.plans)).toHaveLength(1);
			expect(Object.keys(s.receipts)).toHaveLength(1);
		}
	);
});
