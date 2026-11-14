import { describe, expect, it } from 'vitest';
import { ok, Product } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { scenarioDate } from '$lib/core/scenario';
import { createGetContext } from '../agent/get-context';
import { readQuestion } from '../agent/intents/questions';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { chatTurn } from './turn';

const WRITES = new Set([
	'plan_event',
	'place_order',
	'edit_line',
	'find_substitutes',
	'commit_order',
	'propose_menu',
	'approve'
]);

async function setup() {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => FIDELITY_NOW };
	// get_context is served by the server layer; wired as tools/handlers.ts does.
	const handlers = { ...w.handlers, get_context: createGetContext(w.env.ports) } as ToolHandlers;
	const deps = {
		handlers,
		ctx: w.ctx('chef'),
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen: { id: 'k-hotel' },
		today: scenarioDate(FIDELITY_NOW)
	};
	return { w, deps };
}

describe('chat: questions about the mandate and one product', () => {
	it.each([
		'Is the Valio whipping cream recalled?',
		'Where is the butter from?',
		'Does kermavaahto contain gluten?',
		'Tell me about Oltermanni',
		// Mixed words go to the order flow, which may ask but still writes nothing on its own.
		'Is the butter I want to order 4 kg of recalled?'
	])('"%s" never plans, orders or commits', { timeout: 60_000 }, async (text) => {
		const { w, deps } = await setup();
		const events = await chatTurn({ text }, deps);
		for (const e of events) if (e.type === 'step') expect(WRITES.has(e.tool)).toBe(false);
		expect(events.some((e) => e.type === 'decision' || e.type === 'ledger')).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: 'done', canContinue: false });
		expect(w.ops).toHaveLength(0);
		// A pure question is answered, not kept: no task is saved for it.
		if (readQuestion(text)) expect(await w.env.ports.tasks!.list(w.env.workspaceId)).toEqual([]);
	});

	it(
		'answers "what\'s my cap?" in the chef\'s words, without saving a task',
		{ timeout: 60_000 },
		async () => {
			const { w, deps } = await setup();
			const events = await chatTurn({ text: "What's my cap?" }, deps);
			const done = events.at(-1);
			expect(done).toMatchObject({ type: 'done', taskId: '' });
			if (done?.type !== 'done') return;
			expect(done.text).toMatch(/“.+”/);
			expect(done.text).toContain('a line');
			expect(done.text).not.toMatch(/\bsafe\b/i);
			expect(w.ops).toHaveLength(0);
		}
	);

	it(
		'offers "Ask about a product" for unclear words, and says what to type',
		{ timeout: 60_000 },
		async () => {
			const { deps } = await setup();
			const first = await chatTurn({ text: '??' }, deps);
			const clarify = first.find((e) => e.type === 'clarify');
			expect(clarify).toMatchObject({ field: 'intent' });
			if (clarify?.type !== 'clarify') return;
			expect(clarify.options.map((o) => o.value)).toContain('product');
			const next = await chatTurn({ answer: { field: 'intent', value: 'product' } }, deps);
			expect(next.at(-1)).toMatchObject({
				type: 'done',
				text: expect.stringContaining('recalled')
			});
		}
	);
});

describe('chat: "Which one?" before a product answer', () => {
	it(
		'asks with product buttons, then answers the pick without saving a task',
		{ timeout: 60_000 },
		async () => {
			const { w, deps } = await setup();
			const s = await w.handlers.search_products(deps.ctx, { query: 'maito', limit: 2 });
			if (!s.ok) throw new Error(s.error.message);
			const products = s.value.products.map((p, i) =>
				Product.parse({
					...p,
					nameFi: i ? 'Arla täysmaito 1 l' : 'Valio kevytmaito 1 l',
					nameEn: i ? 'Arla whole milk' : 'Valio semi-skimmed milk',
					category: '10400',
					origin: i ? 'se' : 'fi'
				})
			);
			const d = {
				...deps,
				handlers: {
					...deps.handlers,
					search_products: async () => ok({ products })
				} as ToolHandlers
			};
			const first = await chatTurn({ text: 'Where is the milk from?' }, d);
			const ask = first.find((e) => e.type === 'clarify');
			expect(ask).toMatchObject({ field: 'product', question: 'Which one?' });
			if (ask?.type !== 'clarify') return;
			const next = await chatTurn({ answer: { field: 'product', value: ask.options[1].value } }, d);
			expect(next.at(-1)).toMatchObject({
				type: 'done',
				text: "Arla whole milk comes from Sweden, according to Valio's catalogue."
			});
			expect(w.ops).toHaveLength(0);
			expect(await w.env.ports.tasks!.list(w.env.workspaceId)).toEqual([]);
		}
	);
});
