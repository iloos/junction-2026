/**
 * S5 P1 "No task the order here.": the dock remembered a task the sandbox no longer has (a reset, another browser).
 * Words are then a new request, read as usual; an answer or a continue says plainly that the conversation is gone.
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { chatTurn } from './turn';

async function setup() {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => FIDELITY_NOW };
	return {
		handlers: w.handlers,
		ctx: w.ctx('chef'),
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen: { id: 'k-hotel' },
		today: scenarioDate(FIDELITY_NOW)
	};
}

describe('a remembered task that is gone', () => {
	it(
		'"50 eggs for friday" starts a new task, never "No task … here"',
		{ timeout: 120_000 },
		async () => {
			const deps = await setup();
			const out = await chatTurn({ taskId: 'task-gone123', text: '50 eggs for friday' }, deps);
			const text = JSON.stringify(out);
			expect(text).not.toMatch(/No task/);
			expect(out.at(-1)).toMatchObject({ type: 'done' });
			expect(out.at(-1)?.taskId).not.toBe('task-gone123');
			const last = out.at(-1);
			expect(last?.type === 'done' ? last.state : null).not.toBe('failed');
		}
	);

	it('"ok" or an answer for it says the conversation is gone, in words', async () => {
		const deps = await setup();
		for (const input of [
			{ taskId: 'task-gone123', continue: true as const },
			{ taskId: 'task-gone123', answer: { field: 'qty' as const, value: 4 } }
		]) {
			const out = await chatTurn(input, deps);
			const done = out.at(-1);
			expect(done?.type === 'done' && done.text).toMatch(/no longer here.*Tell me again/);
			expect(JSON.stringify(out)).not.toMatch(/task-gone123 here/);
		}
	});
});
