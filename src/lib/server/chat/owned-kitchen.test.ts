/**
 * D24 at the chat door: a kitchen the visitor made takes writes only from its owner. The chat routes put the
 * browser's visitor on the chef's context; with it the chat plans for the owned kitchen, without it the gate refuses.
 */
import { describe, expect, it } from 'vitest';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import type { CallContext } from '$lib/core/ports';
import { chatTurn } from './turn';

describe('chat on a kitchen the visitor owns', () => {
	it(
		'plans with the owner visitor on the context, never without it',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			w.env.ports.clock = { now: () => FIDELITY_NOW };
			const chef = { ...w.ctx('chef'), visitor: 'visitor-a' };
			const made = await w.handlers.create_kitchen(chef, {
				name: 'Pop-up bistro'
			});
			if (!made.ok) throw new Error(made.error.message);
			const kitchenId = made.value.kitchen.kitchenId;
			const deps = (ctx: CallContext) => ({
				handlers: w.handlers,
				ctx,
				ports: w.env.ports,
				workspaceId: w.env.workspaceId,
				kitchen: { id: kitchenId },
				today: scenarioDate(FIDELITY_NOW)
			});

			const mine = await chatTurn({ text: '4 kg butter for Friday' }, deps(chef));
			expect(JSON.stringify(mine)).not.toMatch(/FORBIDDEN|store_owner|owner/i);
			expect(mine.some((e) => e.type === 'step' && e.ok)).toBe(true);

			const { visitor: _drop, ...anon } = chef;
			void _drop;
			const other = await chatTurn({ text: '4 kg butter for Friday' }, deps(anon));
			expect(other.some((e) => e.type === 'step' && e.ok && /Drafted/.test(e.summary))).toBe(false);
		}
	);
});
