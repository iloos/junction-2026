/**
 * Moment 2 in the chat: words → brief → menu → plan. "a no-meat dinner for 120 with a peach dessert" is a vegetarian
 * brief for 120; the menu keeps the diet in every dish and puts the peach in the dessert; "plan it" plans this menu
 * with no refused step left in the transcript, and the closing line counts ingredients in words.
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { acceptMenu } from '../menu/flow';
import { chatTurn } from './turn';

describe('moment 2: words → menu → plan in the chat', () => {
	it('a no-meat dinner for 120 with a peach dessert', { timeout: 180_000 }, async () => {
		const w = await trialWorkspace();
		w.env.ports.clock = { now: () => FIDELITY_NOW };
		const chef = w.ctx('chef');
		const md = {
			workspaceId: w.env.workspaceId,
			store: w.env.ports.menus!,
			catalog: w.env.ports.catalog,
			now: () => w.env.ports.clock.now()
		};
		const deps = {
			handlers: w.handlers,
			ctx: chef,
			ports: w.env.ports,
			workspaceId: w.env.workspaceId,
			kitchen: { id: 'k-hotel' },
			today: scenarioDate(FIDELITY_NOW),
			acceptMenu: (id: string, revision: number) => acceptMenu(md, { id, revision, by: chef.actor })
		};
		const t1 = await chatTurn({ text: 'a no-meat dinner for 120 with a peach dessert' }, deps);
		const taskId = t1[0].taskId;
		// Diet and guests come from the words: only the day, the service and the budget are asked.
		const asked: string[] = [];
		let last = t1;
		for (let i = 0; i < 5; i++) {
			const q = last.find((e) => e.type === 'clarify');
			if (!q || q.type !== 'clarify') break;
			asked.push(q.field);
			last = await chatTurn(
				{
					taskId,
					answer: {
						field: q.field,
						value: JSON.parse(q.options[q.options.length > 1 ? 1 : 0].value)
					}
				},
				deps
			);
		}
		expect(asked).not.toContain('dietary');
		expect(asked).not.toContain('guests');
		const menu = last.find((e) => e.type === 'menu');
		if (menu?.type !== 'menu')
			throw new Error(`no menu card: ${JSON.stringify(last).slice(0, 400)}`);
		const names = menu.dishes.map((d) => d.name).join(', ');
		expect(names).toMatch(/peach/i);
		expect(names).not.toMatch(/salmon|gravlax|pike|beef|ham/i);

		const planned = await chatTurn({ taskId, text: 'plan it' }, deps);
		const steps = planned.filter((e) => e.type === 'step');
		expect(steps.length).toBeGreaterThan(0);
		expect(steps.every((s) => s.type === 'step' && s.ok)).toBe(true);
		const done = planned.at(-1);
		expect(done).toMatchObject({ type: 'done' });
		const text = done?.type === 'done' ? done.text : '';
		expect(text).toMatch(/\d+ ingredients/);
		expect(text).not.toMatch(/\d kg \+|unresolved/);
	});
});
