import { describe, expect, it } from 'vitest';
import type { ToolHandlers } from '$lib/core/ports';
import { createGetContext } from '../get-context';
import { trialWorkspace } from '../trial-harness';
import { answerQuestion, readQuestion } from './questions';

describe('readQuestion', () => {
	it.each([
		["What's my cap?", { kind: 'mandate' }],
		['What can you order on your own?', { kind: 'mandate' }],
		['Mikä on valtuutus?', { kind: 'mandate' }],
		[
			'Is the Valio whipping cream recalled?',
			{ kind: 'product', aspect: 'recall', query: 'Valio whipping cream' }
		],
		['Where is the butter from?', { kind: 'product', aspect: 'origin', query: 'butter' }],
		[
			'Does kermavaahto contain gluten?',
			{ kind: 'product', aspect: 'allergens', query: 'kermavaahto gluten' }
		],
		['Tell me about Oltermanni', { kind: 'product', aspect: 'facts', query: 'Oltermanni' }]
	])('%s', (text, want) => {
		expect(readQuestion(text)).toEqual(want);
	});

	it.each([
		'Order 4 kg butter for Friday',
		'Raise the cap to 2000',
		'Approve it',
		'What still needs my decision?',
		'Is the order recalled?',
		'Plan the Christmas buffet for 140',
		'salmon is short, repair the plan'
	])('leaves "%s" to the agent', (text) => {
		expect(readQuestion(text)).toBeNull();
	});
});

describe('answerQuestion', () => {
	it(
		'answers the mandate in the chef’s words with the enforced numbers, read-only',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			// get_context is served by the server layer; wired here as tools/handlers.ts does.
			const handlers = {
				...w.handlers,
				get_context: createGetContext(w.env.ports)
			} as ToolHandlers;
			const a = await answerQuestion({ kind: 'mandate' }, w.ctx('kitchen_agent'), handlers, {
				kitchenId: 'k-hotel'
			});
			expect(a.text).toContain('Hotel');
			expect(a.text).toMatch(/“.+”/);
			expect(a.text).toContain('€800 a line');
			expect(a.text).toContain('Only a chef changes the mandate');
			expect(a.steps.map((s) => s.tool)).toEqual(['get_context']);
			expect(w.ops).toHaveLength(0);
		}
	);

	it(
		'answers a product question from the catalogue first and never writes',
		{ timeout: 60_000 },
		async () => {
			const w = await trialWorkspace();
			const q = readQuestion('Does kermavaahto contain milk?')!;
			const a = await answerQuestion(q, w.ctx('kitchen_agent'), w.handlers);
			expect(a.steps[0].tool).toBe('search_products');
			expect(a.text.length).toBeGreaterThan(10);
			for (const s of a.steps)
				expect(['search_products', 'check_recall', 'lookup_facts']).toContain(s.tool);
			expect(w.ops).toHaveLength(0);
		}
	);

	it('finds butter as butter (voi), never butternut squash', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'origin', query: 'butter' },
			w.ctx('kitchen_agent'),
			w.handlers
		);
		expect(a.steps[0].summary.toLowerCase()).not.toContain('butternut');
		expect(a.text.toLowerCase()).not.toContain('butternut');
		expect(a.text).not.toMatch(/ from [a-z]{2},/);
	});

	it('says plainly when no product matches', { timeout: 60_000 }, async () => {
		const w = await trialWorkspace();
		const a = await answerQuestion(
			{ kind: 'product', aspect: 'recall', query: 'zzqx unicorn steak' },
			w.ctx('kitchen_agent'),
			w.handlers
		);
		expect(a.text).toContain('no product');
		expect(a.sources).toEqual([]);
	});
});
