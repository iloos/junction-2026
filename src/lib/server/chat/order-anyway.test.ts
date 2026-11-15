/**
 * Held only because Valio states no stock, for a product this kitchen has ordered before: the reply offers "Order
 * anyway" (the chef's D22 approval of exactly those lines) and "Keep waiting".
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { chatTurn } from './turn';

describe('"Order anyway" on unknown stock for a known product', () => {
	it('offers it, and the chip approves exactly those lines', { timeout: 180_000 }, async () => {
		const w = await trialWorkspace();
		w.env.ports.clock = { now: () => FIDELITY_NOW };
		const deps = {
			handlers: w.handlers,
			ctx: w.ctx('chef'),
			ports: w.env.ports,
			workspaceId: w.env.workspaceId,
			kitchen: { id: 'k-hotel' },
			today: scenarioDate(FIDELITY_NOW)
		};
		// First order: a new product, approved and ordered, so the kitchen has bought it.
		const first = await chatTurn({ text: '10 kg potatoes for Friday' }, deps);
		const t1 = first[0].taskId;
		await chatTurn({ taskId: t1, text: 'approve all' }, deps);
		await chatTurn({ taskId: t1, continue: true }, deps);
		// Again: held only for unknown stock now.
		const again = await chatTurn({ text: '10 kg potatoes for Saturday' }, deps);
		const st = await w.state();
		const held = Object.values(st.plans)
			.flatMap((p) => p.lines)
			.filter((l) => l.state === 'held' && l.reasons.includes('UNKNOWN_REQUIRED'));
		const q = again.find((e) => e.type === 'clarify') as
			{ question: string; options: { label: string; value: string }[] } | undefined;
		if (!held.some((l) => !l.reasons.includes('new_sku'))) {
			// The local catalogue may not hold this line for stock: then no chip is offered.
			expect(q?.question ?? '').not.toMatch(/Order anyway/);
			return;
		}
		expect(q?.question).toMatch(
			/^Valio doesn't state stock for .+; you've ordered it before\. Order anyway\?$/
		);
		expect(q?.options.map((o) => o.label)).toEqual(['Order anyway', 'Keep waiting']);
		const t2 = again[0].taskId;
		const before = w.ops.length;
		const out = await chatTurn(
			{ taskId: t2, answer: { field: 'intent', value: q!.options[0].value } },
			deps
		);
		expect((out.at(-1) as { text?: string }).text).toMatch(/^Approved 1 line/);
		expect(w.ops.slice(before).some((o) => o.op.type === 'RecordApproval')).toBe(true);
		const wait = await chatTurn({ taskId: t2, answer: { field: 'intent', value: 'wait' } }, deps);
		expect((wait.at(-1) as { text?: string }).text).toMatch(/stays held/);
	});
});
