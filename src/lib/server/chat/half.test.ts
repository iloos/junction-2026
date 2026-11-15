/** User steer: a half-formed ask gets its likeliest readings as chips, never a rejection; one tap continues. */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { chatTurn } from './turn';

async function deps() {
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
const ask = (out: { type: string }[]) =>
	out.find((e) => e.type === 'clarify') as
		{ question: string; options: { label: string; value: string }[] } | undefined;

describe('half-formed asks get proposals, never a rejection', () => {
	for (const [words, q, chip] of [
		['1000 x', /^Got it, 1,000\. Of what\?$/, /a menu for 1000 guests/],
		['200', /^Got it, 200\. Of what\?$/, /200 l milk/],
		['milk', /^How much milk\?$/, /\d+ l milk/],
		['for friday', /^Got it, Fri 11 Dec\. What should arrive then\?$/, /for Fri 11 Dec/],
		['same as last week', /usual order/, /the usual order for/]
	] as const)
		it(`"${words}" → a reading with chips`, { timeout: 120_000 }, async () => {
			const d = await deps();
			const out = await chatTurn({ text: words }, d);
			const c = ask(out);
			expect(c?.question).toMatch(q);
			expect(c?.options.length).toBeGreaterThanOrEqual(2);
			expect(c?.options.some((o) => chip.test(o.label))).toBe(true);
			expect(JSON.stringify(out)).not.toMatch(/What would you like to do\?|can't order in/);
		});

	it(
		'a chip continues: "1000 x" → "1,000 kg potatoes" carries on as a potato order',
		{ timeout: 120_000 },
		async () => {
			const d = await deps();
			const out = await chatTurn({ text: '1000 x' }, d);
			const c = ask(out)!;
			const potato = c.options.find((o) => /potatoes/.test(o.label))!;
			const next = await chatTurn({ answer: { field: 'intent', value: potato.value } }, d);
			(await import('node:fs')).writeFileSync(
				'scratch/half.txt',
				JSON.stringify(next).slice(0, 1500)
			);
			// The words carry on: a potato order, asking only what is still missing (the day).
			expect(next.at(-1)).toMatchObject({ type: 'done', title: '1000 kg potatoes' });
			expect(next.find((e) => e.type === 'clarify')).toMatchObject({ field: 'date' });
		}
	);
});
