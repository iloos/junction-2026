/**
 * D28 chat trials: the chef's steer words reach find_substitutes with the page's steer, the line changes (or says why
 * not), and the reply names the pick and up to three alternatives with their totals, in short lines.
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { steerWords } from './steer';
import { chatTurn } from './turn';

async function setup() {
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
	const first = await chatTurn({ text: '4 kg butter for Friday' }, deps);
	return { w, deps, taskId: first[0].taskId };
}
const said = (out: { type: string }[]) => {
	const d = out.at(-1) as { type: string; text?: string };
	return d.type === 'done' ? (d.text ?? '') : '';
};

describe('D28: steer words', () => {
	it('reads each steer', () => {
		expect(steerWords('something cheaper')).toMatchObject({ rankBy: 'price' });
		expect(steerWords('a Finnish one')).toMatchObject({ requireOrigin: 'fi' });
		expect(steerWords('organic please')).toMatchObject({ steer: { organic: true } });
		expect(steerWords('bigger pack')).toMatchObject({ steer: { pack: 'bigger' } });
		expect(steerWords('same brand')).toMatchObject({ steer: { sameBrand: true } });
		expect(steerWords('if no ham then salmon')).toMatchObject({
			steer: { text: 'salmon', differentKind: true },
			onlyIf: 'ham'
		});
		expect(steerWords('a cheaper butter')).toMatchObject({ rankBy: 'price', target: 'butter' });
		expect(steerWords('10 kg cheaper butter')).toBeNull();
		expect(steerWords('4 kg butter for Friday')).toBeNull();
	});
});

describe('D28: the chef steers in the chat', () => {
	for (const words of [
		'something cheaper',
		'a Finnish one',
		'organic please',
		'bigger pack',
		'same brand'
	])
		it(
			`"${words}" answers with a pick or a reason, never an order`,
			{ timeout: 120_000 },
			async () => {
				const { w, deps, taskId } = await setup();
				const before = w.ops.length;
				const out = await chatTurn({ taskId, text: words }, deps);
				const text = said(out);
				expect(text).toMatch(
					/^(Switched .+ to .+|.+ is the best fit; .+ stays\.|Nothing fits that for .+)/
				);
				expect(text).not.toMatch(/One product per routine order|did not recognise/);
				// Alternatives, when there are any, are short lines with a total.
				for (const l of text.split('\n').filter((x) => x.startsWith('• ')))
					expect(l).toMatch(/· €\d+\.\d{2}|: /);
				// A steer never commits.
				expect(w.ops.slice(before).some((o) => o.op.type === 'CommitOrder')).toBe(false);
			}
		);

	it('"if no butter then margarine" keeps an orderable butter', { timeout: 120_000 }, async () => {
		const { deps, taskId } = await setup();
		const out = await chatTurn({ taskId, text: 'if no butter then margarine' }, deps);
		expect(said(out)).toMatch(
			/can be ordered, so it stays\. I'll switch to margarine only if it can't\./
		);
	});
});
