/**
 * D33 addendum (user, on prod): never end a turn on "I could not". The four asks from the user's transcript each get
 * the likeliest reading and chips that continue, the amount kept.
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
type Out = Awaited<ReturnType<typeof chatTurn>>;
const chips = (out: Out) => {
	const c = out.findLast((e) => e.type === 'clarify');
	return c?.type === 'clarify' ? c : null;
};
const said = (out: Out) => JSON.stringify(out);
const NEVER = /I could not|could not match it|What would you like to do\?|There is no plan yet/;

describe('never "I could not": the user transcript', () => {
	it(
		'"100 streaks" → "Did you mean steaks?", portions or kg, product chips',
		{ timeout: 120_000 },
		async () => {
			const out = await chatTurn({ text: '100 streaks' }, await setup());
			const c = chips(out);
			expect(c?.question).toMatch(
				/^Did you mean steaks\?.*100 portions( \(about [\d.]+ kg\))? or 100 kg\?/
			);
			expect(c?.options.length).toBeGreaterThanOrEqual(2);
			expect(said(out)).not.toMatch(NEVER);
		}
	);

	for (const words of ['steaks', 'cow meat'])
		it(`"${words}" → the closest products as chips`, { timeout: 120_000 }, async () => {
			const out = await chatTurn({ text: words }, await setup());
			const c = chips(out);
			expect(c?.options.length).toBeGreaterThanOrEqual(1);
			expect(said(out)).not.toMatch(NEVER);
		});

	it(
		'"2kg cow" for a day nothing can come → next days as chips; "???? and??" → where it stands',
		{
			timeout: 180_000
		},
		async () => {
			const d = await setup();
			const t1 = await chatTurn({ text: '2kg cow' }, d);
			const taskId = t1[0].taskId;
			const t2 = await chatTurn({ taskId, text: 'Friday' }, d);
			expect(said(t2)).not.toMatch(NEVER);
			expect(chips(t2)?.options.length).toBeGreaterThanOrEqual(1);
			const t3 = await chatTurn({ taskId, text: '???? and??' }, d);
			expect(said(t3)).not.toMatch(NEVER);
			expect(chips(t3)?.options.length).toBeGreaterThanOrEqual(1);
		}
	);
});

describe('N + food and a new noun', () => {
	it(
		'"i want 100 pasta" → "100 portions (about 10 kg) or 100 kg?" with the portions chip first',
		{
			timeout: 120_000
		},
		async () => {
			const out = await chatTurn({ text: 'i want 100 pasta' }, await setup());
			const c = chips(out);
			expect(c?.question).toMatch(/100 portions \(about 10 kg\) or 100 kg\?/);
			expect(c?.options[0].label).toBe('100 portions (~10 kg)');
			expect(said(out)).not.toMatch(NEVER);
		}
	);

	it(
		'"steaks" while "When should beef arrive?" is open is a new ask, not a date',
		{ timeout: 180_000 },
		async () => {
			const d = await setup();
			const t1 = await chatTurn({ text: '2kg cow' }, d);
			expect(chips(t1)?.field).toBe('date');
			expect(said(t1)).not.toMatch(/YYYY-MM-DD/);
			const t2 = await chatTurn({ taskId: t1[0].taskId, text: 'steaks' }, d);
			expect(chips(t2)?.field).not.toBe('date');
			expect(said(t2)).not.toMatch(NEVER);
		}
	);
});

describe('a fragment reply never reaches the chef', () => {
	it(
		"a model answer of '\".' gives the template sentence instead",
		{ timeout: 120_000 },
		async () => {
			const d = await setup();
			const fragment = {
				async generate() {
					return { text: '".', model: 'gemini-test', tokens: { in: 1, out: 1 }, latencyMs: 1 };
				}
			};
			const t1 = await chatTurn({ text: '4 kg butter for Friday' }, d);
			const t2 = await chatTurn({ taskId: t1[0].taskId, text: 'where does it stand?' }, {
				...d,
				models: { explain: fragment }
			} as never);
			const done = t2.at(-1) as { type: string; text?: string };
			expect(done.text).not.toBe('".');
			expect(done.text).toMatch(/\p{L}{3}/u);
		}
	);
});

describe('the coffee, cheesecake and biscuits transcript', () => {
	it(
		'several things in one message are taken one at a time; "wym", "huh?" restate the question',
		{
			timeout: 180_000
		},
		async () => {
			const d = await setup();
			const t1 = await chatTurn(
				{
					text: 'i want 10kg coffee beans, and ingredients to make 5kg cheesecake. And some buscuits'
				},
				d
			);
			const c1 = chips(t1)!;
			expect(c1.question).toMatch(
				/^I'll take them one at a time\. Start with 10kg coffee beans\?$/
			);
			expect(c1.options.some((o) => /cheesecake/.test(o.label))).toBe(true);
			expect(said(t1)).not.toMatch(/One product per routine order/);
			const taskId = t1[0].taskId;
			for (const meta of ['wym one product per routine order?', 'huh?', 'where is the 1?']) {
				const t = await chatTurn({ taskId, text: meta }, d);
				const c = chips(t);
				expect(c?.question).toMatch(/^I asked: /);
				expect(c?.options.length).toBeGreaterThanOrEqual(2);
				expect(said(t)).not.toMatch(/wym|routine arrive|of what unit/i);
			}
		}
	);
});
