/**
 * D20: the reading is a general shape (what, how much, intent); code handles each kind once. These tests drive the
 * kinds through a stand-in model (the shape it returns) and the rules fixture, never a phrase list.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { howMuchWords, unitsFor } from './amount';
import { parseRules } from './parse';
import { runRequest } from './run';

const shape = (out: unknown, model = 'gemini-test'): Llm => ({
	generate: async () => ({
		text: JSON.stringify(out),
		model,
		tokens: { in: 10, out: 20 },
		latencyMs: 5
	})
});

async function setup() {
	const env = await createDbPorts({ now: '2026-12-07T09:00:00+02:00' });
	env.overlay.clear();
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'kitchen_agent', id: 'a' },
		scopes: SCOPES_BY_ACTOR.kitchen_agent,
		via: 'test'
	};
	const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
	return {
		handlers: createHandlers(env.ports),
		ctx,
		today: '2026-12-07',
		kitchen,
		clock: env.ports.clock,
		place: false as const
	};
}

describe('the rules fixture fills the shape from what it already reads', () => {
	it('exact, for people, unknown', () => {
		expect(parseRules('20 kg carrots', '2026-12-07').items[0].amount).toEqual({ kind: 'exact' });
		expect(parseRules('milk for 300 breakfasts', '2026-12-07').items[0].amount).toEqual({
			kind: 'for_people',
			n: 300
		});
		expect(parseRules('i want all your apples', '2026-12-07').items[0].amount).toEqual({
			kind: 'unknown'
		});
	});
});

describe('units and grammar come from the item', () => {
	it('"How many apples?", "How much milk?"', () => {
		expect(howMuchWords('apples', ['kg'])).toBe('How many apples?');
		expect(howMuchWords('milk', ['l'])).toBe('How much milk?');
		expect(howMuchWords('glass', ['kg'])).toBe('How much glass?');
	});
	it('never litres for a solid sold by weight', () => {
		const solid = {
			salesUnit: 'KG',
			baseUnit: 'KG',
			packs: [],
			nameFi: 'Omena',
			netPerSalesUnit: null
		};
		expect(unitsFor([solid as never])[0]).toBe('kg');
		expect(unitsFor([solid as never])).not.toContain('l');
	});
});

describe('each kind is handled once', () => {
	it('max_available: the stated stock, prefilled, with what the mandate allows', async () => {
		const base = await setup();
		const r = await runRequest('everything you have in butter, Thursday', {
			...base,
			llmKind: 'gemini',
			llm: shape({
				intent: 'order',
				items: [
					{
						query: 'butter',
						what: 'product',
						amount: { kind: 'max_available' },
						qty: null,
						unit: null,
						searchFi: ['voi']
					}
				]
			})
		});
		const it0 = r.lookup!.items[0];
		expect(it0.item.amount).toEqual({ kind: 'max_available' });
		expect(it0.question).toMatch(
			/^(Valio states .+ of butter across \d+ product|Valio states no quantity)/
		);
		if (it0.answer?.kind === 'qty' && it0.answer.prefill) {
			expect(it0.answer.prefill.qty).toBeGreaterThan(0);
			expect(it0.answer.productId).toMatch(/^\d{6}$/);
			expect(it0.question).toMatch(/line limit/);
		}
	});

	it('a question or a change searches and orders nothing', async () => {
		const base = await setup();
		for (const intent of ['question', 'change'] as const) {
			const r = await runRequest('words', {
				...base,
				llmKind: 'gemini',
				llm: shape({ intent, items: [{ query: 'oats', qty: null, unit: null }] })
			});
			expect(r.lookup).toBeNull();
			expect(r.message).toMatch(
				intent === 'question' ? /reads as a question/ : /reads as a change/
			);
		}
	});

	it('a model-read dish for N people goes down the dish path', async () => {
		const base = await setup();
		const r = await runRequest('pasta bolognese for the conference lunch', {
			...base,
			llmKind: 'gemini',
			llm: shape({
				intent: 'order',
				items: [
					{
						query: 'pasta bolognese',
						what: 'dish',
						amount: { kind: 'for_people', n: 150 },
						qty: null,
						unit: null
					}
				]
			})
		});
		expect(r.parsed.dish?.portions).toBe(150);
	});

	it('a range is read at its top and says so', async () => {
		const base = await setup();
		const r = await runRequest('cream', {
			...base,
			llmKind: 'gemini',
			llm: shape({
				items: [
					{
						query: 'cream',
						amount: { kind: 'range', min: 5, max: 8 },
						qty: null,
						unit: 'l',
						searchFi: ['kerma']
					}
				]
			})
		});
		expect(r.parsed.items[0]).toMatchObject({ qty: 8, unit: 'l' });
		expect(r.parsed.items[0].ambiguities.join()).toMatch(/a range \(5–8\)/);
	});
});

describe('the D12 cascade: an unsure first reading is read again by the stronger model', () => {
	it('escalates when the first model leaves the amount unknown, and names both models', async () => {
		const base = await setup();
		const r = await runRequest('as many eggs as you can spare, Thursday', {
			...base,
			llmKind: 'gemini',
			llm: shape(
				{ items: [{ query: 'eggs', qty: null, unit: null, searchFi: ['kananmuna'] }] },
				'gemini-3.5-flash-lite'
			),
			escalate: shape(
				{
					items: [
						{
							query: 'eggs',
							amount: { kind: 'max_available' },
							qty: null,
							unit: null,
							searchFi: ['kananmuna']
						}
					]
				},
				'gemini-3.8-flash'
			)
		});
		expect(r.parsed.parser).toMatchObject({
			model: 'gemini-3.8-flash',
			escalatedFrom: 'gemini-3.5-flash-lite'
		});
		expect(r.parsed.items[0].amount).toEqual({ kind: 'max_available' });
	});

	it('a sure first reading is not escalated', async () => {
		const base = await setup();
		let calls = 0;
		const r = await runRequest('20 kg carrots Thursday', {
			...base,
			llmKind: 'gemini',
			llm: shape({ items: [{ query: 'carrots', qty: 20, unit: 'kg', searchFi: ['porkkana'] }] }),
			escalate: {
				generate: async () => {
					calls++;
					throw new Error('not called');
				}
			}
		});
		expect(calls).toBe(0);
		expect(r.parsed.parser.escalatedFrom).toBeUndefined();
	});
});
