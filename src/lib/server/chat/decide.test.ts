/**
 * D22 chat trials: the chef in their own dock approves or keeps held the lines the last turn showed, on the version
 * shown, through `approve` as the chef. Nothing shown, a moved plan, an unknown product and a cap change each get a
 * plain answer and decide nothing.
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { decisionWords } from './decide';
import { chatTurn } from './turn';

async function setup() {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => FIDELITY_NOW };
	const chef = w.ctx('chef');
	const deps = {
		handlers: w.handlers,
		ctx: chef,
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen: { id: 'k-hotel' },
		today: scenarioDate(FIDELITY_NOW)
	};
	const granted = () =>
		w.ops.filter(
			(o) =>
				o.op.type === 'RecordApproval' &&
				o.op.approval.state === 'granted' &&
				o.actor.kind === 'chef'
		).length;
	const denied = () =>
		w.ops.filter((o) => o.op.type === 'RecordApproval' && o.op.approval.state === 'denied').length;
	return { w, deps, granted, denied };
}

const text = (out: { type: string }[]) => {
	const d = out.at(-1) as { type: string; text?: string };
	return d.type === 'done' ? (d.text ?? '') : '';
};

describe('D22: the chef decides in the dock', () => {
	it('words', () => {
		expect(decisionWords('approve all')).toEqual({ decision: 'grant', all: true });
		expect(decisionWords('accept the salmon')).toMatchObject({
			decision: 'grant',
			all: false,
			target: 'salmon'
		});
		expect(decisionWords('reject the herring')).toMatchObject({
			decision: 'deny',
			target: 'herring'
		});
		expect(decisionWords('hyväksy kaikki')).toMatchObject({ decision: 'grant', all: true });
		expect(decisionWords('approve a higher cap')).toBeNull();
		expect(decisionWords('can you raise the cap')).toBeNull();
	});

	it(
		'"approve all" approves the shown lines as the chef, in one line',
		{ timeout: 120_000 },
		async () => {
			const { deps, granted } = await setup();
			const big = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
			expect(big.some((e) => e.type === 'decision')).toBe(true);
			const taskId = big[0].taskId;
			const out = await chatTurn({ taskId, text: 'approve all' }, deps);
			expect(text(out)).toMatch(/^Approved \d+ lines? · €\d+\.\d{2}\./);
			expect(text(out)).not.toMatch(/only the chef approves/);
			expect(granted()).toBe(1);
		}
	);

	it(
		'"reject the butter" keeps it held; "accept the salmon" names what is there',
		{ timeout: 120_000 },
		async () => {
			const { deps, granted, denied } = await setup();
			const big = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
			const taskId = big[0].taskId;
			const none = await chatTurn({ taskId, text: 'accept the salmon' }, deps);
			expect(text(none)).toMatch(/None of the lines waiting for you is "salmon"/);
			expect(granted()).toBe(0);
			const out = await chatTurn({ taskId, text: 'reject the butter' }, deps);
			expect(text(out)).toMatch(/^Kept 1 line held: .+\. It is not ordered\./);
			expect(denied()).toBe(1);
		}
	);

	it('"approve all" with nothing shown decides nothing', { timeout: 120_000 }, async () => {
		const { deps, granted } = await setup();
		const out = await chatTurn({ text: 'approve all' }, deps);
		expect(text(out)).toMatch(/Nothing is waiting for your approval/);
		expect(granted()).toBe(0);
	});

	it('a plan that moved since it was shown is not decided', { timeout: 120_000 }, async () => {
		const { w, deps, granted } = await setup();
		const big = await chatTurn({ text: 'Order 60 kg butter for Friday' }, deps);
		const taskId = big[0].taskId;
		const card = big.find((e) => e.type === 'decision');
		if (card?.type !== 'decision') throw new Error('no card');
		const p = await w.handlers.get_plan(deps.ctx, { planId: card.planId });
		if (!p.ok) throw new Error(p.error.message);
		const line = p.value.plan.lines[0];
		const edit = await w.handlers.edit_line(deps.ctx, {
			planId: card.planId,
			version: p.value.plan.version,
			lineId: line.id,
			patch: { qty: line.qty.value + 1 }
		} as never);
		expect(edit.ok).toBe(true);
		const out = await chatTurn({ taskId, text: 'approve all' }, deps);
		expect(text(out)).toMatch(/The plan changed since I showed it/);
		expect(granted()).toBe(0);
	});
});
