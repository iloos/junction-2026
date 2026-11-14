/**
 * Shares in the reading (ring 6, S3 item 1): a count with a dish noun is servings, and each share with a diet word
 * is a counted requirement. The held-out phrasings are not used anywhere else in the parser or its prompt.
 */
import { describe, expect, it } from 'vitest';
import { readShares } from './shares';

describe('shares: the user-reported prod failure', () => {
	it('"hi i want 500 pizzas no meat 50%" → 250 meat-free + 250 any, proposed as one tap', () => {
		const r = readShares('hi i want 500 pizzas no meat 50%')!;
		expect(r).toMatchObject({ total: 500, dish: 'pizza', rest: 250, dietary: ['vegetarian:250'] });
		expect(r.sentence).toBe('250 meat-free and 250 regular pizzas');
		expect(r.ask?.question).toBe('250 meat-free and 250 regular pizzas?');
		expect(r.ask?.no).toMatch(/all 500 with half the meat/);
	});
});

describe('shares: held out', () => {
	it('"300 burgers, a third vegan" → 100 vegan + 200 regular, no question', () => {
		const r = readShares('300 burgers, a third vegan')!;
		expect(r).toMatchObject({ total: 300, rest: 200, dietary: ['vegan:100'], ask: null });
		expect(r.sentence).toBe('100 vegan and 200 regular burgers');
	});
	it('"half the 80 lunches gluten-free" → 40 gluten-free of 80', () => {
		const r = readShares('half the 80 lunches gluten-free')!;
		expect(r).toMatchObject({ total: 80, dish: 'lunch', rest: 40, dietary: ['gluten-free:40'] });
	});
	it('"200 pizzas 40% veggie" → 80 vegetarian + 120 regular', () => {
		const r = readShares('200 pizzas 40% veggie')!;
		expect(r).toMatchObject({ total: 200, rest: 120, dietary: ['vegetarian:80'], ask: null });
	});
	it('"120 meals, 30 of them vegan and a quarter gluten-free"', () => {
		const r = readShares('120 meals, 30 of them vegan and a quarter gluten-free')!;
		expect(r.dietary).toEqual(['vegan:30', 'gluten-free:30']);
		expect(r.rest).toBe(60);
	});
	it('"200 vegan pizzas" → every serving vegan', () => {
		const r = readShares('200 vegan pizzas')!;
		expect(r).toMatchObject({ total: 200, parts: [], dietary: ['vegan'] });
		expect(r.sentence).toBe('200 vegan pizzas');
	});
	it('"500 pizzas" alone is servings with no requirement', () => {
		expect(readShares('500 pizzas')).toMatchObject({ total: 500, dietary: [], parts: [] });
	});
	it('Finnish: "100 annosta, puolet kasvis"', () => {
		expect(readShares('100 annosta, puolet kasvis')?.dietary).toEqual(['vegetarian:50']);
	});
});

describe('shares: purchases stay purchases', () => {
	for (const t of [
		'milk for 300 breakfasts',
		'20 kg pizza flour',
		'40 burger buns',
		'6 pizza bases',
		'2 kg butter, half lactose-free',
		'10000 bolognese pasta, half only cow and the other half half'
	])
		it(`"${t}" is not servings`, () => expect(readShares(t)).toBeNull());
});

/* ── Both doors ───────────────────────────────────────────────────────────── */

import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { runRequest } from './run';
import { classifyGoal } from '../agent/classify';
import { applyBriefAnswers, draftBrief, nextQuestion } from '../menu/brief';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { chatTurn } from '../chat/turn';

const TODAY = '2026-12-07';
const HELD_OUT = [
	'hi i want 500 pizzas no meat 50%',
	'300 burgers, a third vegan',
	'half the 80 lunches gluten-free',
	'200 pizzas 40% veggie'
];

describe('shares: the brief', () => {
	it('the ambiguous reading is the first question, its likeliest form one tap', () => {
		const d = draftBrief('hi i want 500 pizzas no meat 50%', TODAY);
		expect(d.guests).toBe(500);
		const q = nextQuestion(d, TODAY)!;
		expect(q).toMatchObject({ id: 'brief.dietary', text: '250 meat-free and 250 regular pizzas?' });
		const yes = applyBriefAnswers(d, [q.chips[0].answer], TODAY);
		expect(yes.dietary).toEqual(['vegetarian:250']);
		expect(nextQuestion(yes, TODAY)?.id).not.toBe('brief.dietary');
	});
	it('an unambiguous share fills the requirement and says how it was read', () => {
		const d = draftBrief('300 burgers, a third vegan', TODAY);
		expect(d).toMatchObject({ guests: 300, dietary: ['vegan:100'] });
		expect(d.notes).toContain('read as 100 vegan and 200 regular burgers');
	});
});

describe('shares: /request and chat read the same words the same way', () => {
	for (const t of HELD_OUT)
		it(`classifyGoal("${t}") is an event`, () =>
			expect(classifyGoal(t, TODAY)).toMatchObject({ kind: 'event' }));

	it(
		'/request: an event with the servings as guests, nothing searched',
		{ timeout: 60_000 },
		async () => {
			const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
			const ctx: CallContext = {
				workspaceId: env.workspaceId,
				runId: env.runId,
				actor: { kind: 'kitchen_agent', id: 'a' },
				scopes: SCOPES_BY_ACTOR.kitchen_agent,
				via: 'test'
			};
			const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
			const deps = {
				handlers: createHandlers(env.ports),
				ctx,
				today: TODAY,
				kitchen,
				clock: env.ports.clock
			};
			for (const t of HELD_OUT) {
				const r = await runRequest(t, deps);
				expect(r.lookup, t).toBeNull();
				expect(r.event?.draft?.guests, t).toBeGreaterThan(1);
				expect(r.message, t).not.toMatch(/can't order in|nothing matched/i);
			}
			const first = await runRequest(HELD_OUT[0], deps);
			expect(first.event?.question?.text).toBe('250 meat-free and 250 regular pizzas?');
		}
	);

	it('chat: the same question, then the brief goes on', { timeout: 120_000 }, async () => {
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
		const t1 = await chatTurn({ text: HELD_OUT[0] }, deps);
		const text = JSON.stringify(t1);
		expect(text).toContain('250 meat-free and 250 regular pizzas?');
		expect(text).not.toMatch(/can't order in pizzas/);
	});
});
