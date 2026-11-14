/**
 * The judge-probe defects (SYNTHESIS F3, F7, F17): constraints survive the model, answers stay on
 * their item, events are not catalogue queries, and the parser reads what chefs actually type.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Product } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { classifyRequest } from './classify';
import { findDate } from './dates';
import { filterHits, withLot } from './lookup';
import { convert } from './convert';
import { parseRequest, parseRules } from './parse';
import { runRequest, skipSummary } from './run';

const TODAY = '2026-11-14';
const VALIO = '1,000 L lactose-free milk by Monday';

/** A model stand-in that answers with fixed JSON. */
const model = (out: unknown): Llm => ({
	generate: async () => ({
		text: JSON.stringify(out),
		model: 'gemini-test',
		tokens: { in: 10, out: 20 },
		latencyMs: 5
	})
});

async function setup() {
	const env = await createDbPorts();
	env.overlay.clear();
	const h = createHandlers(env.ports);
	const ctx: CallContext = {
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind: 'kitchen_agent', id: 'a' },
		scopes: SCOPES_BY_ACTOR.kitchen_agent,
		via: 'test'
	};
	const kitchen = (await env.store.kitchens(env.workspaceId)).find((k) => k.id === 'k-hotel')!;
	return { h, ctx, kitchen, catalog: env.ports.catalog };
}

describe('F3: typed constraints survive the model parse', () => {
	it("keeps lactose-free on Valio's example when the model drops it, and says so", async () => {
		const r = await parseRequest(VALIO, {
			today: TODAY,
			llmKind: 'gemini',
			llm: model({
				items: [{ query: 'milk', qty: 1000, unit: 'l', constraints: [], searchFi: ['maito'] }],
				deliverBy: '2026-11-16'
			})
		});
		expect(r.parser.kind).toBe('gemini');
		const [i] = r.items;
		expect(i.constraints).toEqual(['lactose_free']);
		expect(i.search[0]).toBe('maito laktoositon');
		expect(i.query).toBe('lactose-free milk');
		expect(i.ambiguities.join()).toMatch(/model dropped lactose-free: kept from your words/);
	});

	it('flags a constraint the model added that the words do not state', async () => {
		const r = await parseRequest('1,000 L milk by Monday', {
			today: TODAY,
			llmKind: 'gemini',
			llm: model({
				items: [
					{ query: 'milk', qty: 1000, unit: 'l', constraints: ['organic'], searchFi: ['maito'] }
				]
			})
		});
		expect(r.items[0].ambiguities.join()).toMatch(/the model read organic, the rules did not/);
	});

	it('orders lactose-free milk (464201) end to end when the model drops the constraint', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest(VALIO, {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'f3',
			llmKind: 'gemini',
			llm: model({
				items: [{ query: 'milk', qty: 1000, unit: 'l', constraints: [], searchFi: ['maito'] }]
			})
		});
		const pick = r.lookup!.items[0].pick!;
		expect(pick.productId).toBe('464201');
		expect(pick.name.toLowerCase()).toContain('laktoositon');
	}, 60_000);
});

describe('F17: answers are keyed by a stable item id', () => {
	it('gives the same id on the rules and the model path, whatever order the model uses', async () => {
		const text = '500 g butter and lactose-free milk by Monday';
		const rules = parseRules(text, TODAY);
		expect(rules.items.map((i) => i.id)).toEqual(['butter', 'milk.lactose_free']);
		const m = await parseRequest(text, {
			today: TODAY,
			llmKind: 'gemini',
			llm: model({
				items: [
					{ query: 'milk', qty: null, unit: null, constraints: [], searchFi: ['maito'] },
					{ query: 'butter', qty: 0.5, unit: 'kg', constraints: [], searchFi: ['voi'] }
				]
			})
		});
		expect(m.items.map((i) => i.id)).toEqual(['milk.lactose_free', 'butter']);
	});

	it('an amount answer lands on the milk even when the model lists it first', async () => {
		const { h, ctx, kitchen } = await setup();
		const text = '500 g butter and lactose-free milk by Monday';
		const r = await runRequest(text, {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'ids',
			place: false,
			answers: [{ item: 'milk.lactose_free', qty: 1000, unit: 'l' }],
			llmKind: 'gemini',
			llm: model({
				items: [
					{ query: 'milk', qty: null, unit: null, constraints: [], searchFi: ['maito'] },
					{ query: 'butter', qty: 0.5, unit: 'kg', constraints: [], searchFi: ['voi'] }
				]
			})
		});
		const milk = r.parsed.items.find((i) => i.product === 'milk')!;
		const butter = r.parsed.items.find((i) => i.product === 'butter')!;
		expect(milk).toMatchObject({ qty: 1000, unit: 'l' });
		expect(butter).toMatchObject({ qty: 0.5, unit: 'kg' });
	}, 60_000);

	it('numbers repeated items', () => {
		const r = parseRules('2 kg butter, 5 kg butter by Friday', TODAY);
		expect(r.items.map((i) => i.id)).toEqual(['butter', 'butter~2']);
	});
});

describe('F7: an event brief is not a catalogue query', () => {
	it('classifies open event requests and leaves purchases alone', () => {
		const ev = (t: string) => classifyRequest(t, parseRules(t, TODAY).items, 'k-hotel');
		expect(ev('Christmas dinner for 50 on 20 December')).toMatchObject({
			guests: 50,
			seeded: { eventId: 'event-xmas-140' }
		});
		expect(ev('5-star 5-course dinner for 50')).toMatchObject({
			guests: 50,
			courses: 5,
			seeded: null
		});
		expect(ev('wedding buffet, 120 guests, Saturday')).toMatchObject({ guests: 120 });
		expect(ev('20 kg salmon fillets for the Christmas dinner')).toBeNull();
		expect(ev('lactose-free milk for the lunch menu')).toBeNull();
		expect(ev(VALIO)).toBeNull();
		expect(classifyRequest('Christmas dinner for 50', [], 'k-school')?.seeded).toBeNull();
	});

	it('asks the first missing brief question and searches nothing', async () => {
		const { h, ctx, kitchen } = await setup();
		const steps: string[] = [];
		const r = await runRequest('5-star 5-course dinner for 50', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			onEvent: (e) => steps.push(`${e.step}:${e.status}`)
		});
		expect(steps).toEqual(['request:blocked']);
		expect(r.lookup).toBeNull();
		expect(r.order).toBeNull();
		expect(r.event).toMatchObject({ guests: 50, courses: 5, seeded: null });
		expect(r.event?.question?.id).toBe('brief.date');
		expect(r.message).toMatch(/event to plan.*On which day/);
	}, 60_000);

	it('points a Christmas brief at the seeded event and keeps asking for the brief', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('Christmas dinner for 50 on 20 December', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen
		});
		expect(r.event).toMatchObject({
			guests: 50,
			deliverBy: '2026-12-20',
			seeded: { eventId: 'event-xmas-140' }
		});
		expect(r.event?.draft).toMatchObject({ guests: 50, date: '2026-12-20' });
		expect(r.event?.question?.id).toBe('brief.serviceStyle');
	}, 60_000);

	it('brief answers by id complete the brief; still nothing is searched', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('Christmas dinner for 50 on 20 December', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			briefAnswers: [
				{ id: 'brief.budget', value: 0 },
				{ id: 'brief.serviceStyle', value: 'buffet' },
				{ id: 'brief.dietary', value: ['lactose-free'] }
			]
		});
		expect(r.lookup).toBeNull();
		expect(r.event?.question).toBeNull();
		expect(r.event?.draft).toMatchObject({ serviceStyle: 'buffet', dietary: ['lactose-free'] });
		expect(r.message).toMatch(/brief is complete/);
	}, 60_000);
});

describe('F17: parser defects', () => {
	it('reads "2 x 10 kg" as 20 kg', () => {
		expect(parseRules('2 x 10 kg butter by Friday', TODAY).items[0]).toMatchObject({
			product: 'butter',
			qty: 20,
			unit: 'kg'
		});
		expect(parseRules('4×5 l cream by Friday', TODAY).items[0]).toMatchObject({
			qty: 20,
			unit: 'l'
		});
	});

	it('"for 300 breakfasts" is a cover count, not a quantity', () => {
		const e = parseRules('eggs for 300 breakfasts by Friday', TODAY).items[0];
		expect(e).toMatchObject({ product: 'eggs', qty: null });
		expect(e.ambiguities.join()).toMatch(/how much\? \("for 300 breakfasts" is how many you serve/);
		const p = parseRules('200 kg potatoes for 300 breakfasts by Friday', TODAY).items[0];
		expect(p).toMatchObject({ product: 'potatoes', qty: 200, unit: 'kg' });
	});

	it('reads month-name dates in English and Finnish', () => {
		expect(findDate('on 20 December', TODAY)?.iso).toBe('2026-12-20');
		expect(findDate('by Dec 20th', TODAY)?.iso).toBe('2026-12-20');
		expect(findDate('20th of december 2026', TODAY)?.iso).toBe('2026-12-20');
		expect(findDate('20. joulukuuta', TODAY)?.iso).toBe('2026-12-20');
		expect(findDate('by 3 January', TODAY)?.iso).toBe('2027-01-03');
		expect(parseRules('200 kg potatoes on 20 December', TODAY).items[0]).toMatchObject({
			qty: 200,
			unit: 'kg'
		});
	});

	it('refuses impossible dates instead of passing them on', () => {
		expect(findDate('by 2026-02-30', TODAY)?.invalid).toMatch(/not a real date/);
		expect(findDate('31.11.', TODAY)?.invalid).toMatch(/not a real date/);
		const r = parseRules('200 kg potatoes by 2026-13-01', TODAY);
		expect(r.deliverBy).toBe(TODAY);
		expect(r.deliverBySource).toBe('default');
		expect(r.ambiguities.join()).toMatch(/"2026-13-01" is not a real date: using today/);
	});

	it('the model cannot fill an impossible date with its own guess', async () => {
		const r = await parseRequest('200 kg potatoes by 2026-02-30', {
			today: TODAY,
			llmKind: 'gemini',
			llm: model({
				items: [{ query: 'potatoes', qty: 200, unit: 'kg', searchFi: ['peruna'] }],
				deliverBy: '2026-03-02'
			})
		});
		expect(r.deliverBy).toBe(TODAY);
	});

	it('"salmon fillets" ranks fish fillets, never the salmon cheese tart', async () => {
		const { catalog } = await setup();
		const item = parseRules('20 kg salmon fillets by Friday', TODAY).items[0];
		expect(item).toMatchObject({ product: 'salmon', variant: { token: 'filee' } });
		expect(item.search[0]).toBe('lohifilee');
		const hits: Product[] = [];
		for (const q of item.search) hits.push(...(await catalog.search(q, { limit: 50 })));
		const { ranked } = filterHits(item, hits);
		expect(ranked.length).toBeGreaterThan(0);
		for (const r of ranked.slice(0, 5)) expect(r.product.nameFi.toLowerCase()).toMatch(/lohi/);
		expect(ranked[0].product.nameFi.toLowerCase()).toMatch(/filee/);
		expect(ranked.some((r) => /juustotorttu/i.test(r.product.nameFi))).toBe(false);
		// The tart (462463, a ready meal) is out of the fish categories even when searched directly.
		const tart = (await catalog.get(['462463'])).get('462463')!;
		expect(filterHits(item, [tart]).rejected[0].reason).toMatch(/not in the salmon category/);
	}, 60_000);

	it('the preview rounds to the lot step the order will use', () => {
		const p = {
			productId: '9',
			nameFi: 'Testi peruna',
			category: '17421',
			categoryGroup: '17',
			isFood: true,
			vendor: 'v',
			labels: [],
			temperatureClass: 'chilled',
			salesUnit: 'KG',
			baseUnit: 'KG',
			packs: [],
			lotStep: 2.5,
			catchWeight: false,
			allergens: { contains: [], mayContain: [], declared: true },
			freeFrom: [],
			diet: [],
			valioSubstitutes: [],
			dataQualityFlags: []
		} as Product;
		const c = withLot(convert(11, 'kg', p), p);
		expect(c).toMatchObject({ ok: true, salesQty: 12.5, exact: false });
		expect(c.ok && c.warnings.join()).toMatch(/lot size: 11 KG → 5 × 2.5 KG lot = 12.5 KG/);
	});

	it('names each skip reason instead of a generic "can\'t be delivered"', () => {
		expect(
			skipSummary([
				{ skipped: 'out of stock at Valio' },
				{ skipped: 'out of stock at Valio' },
				{ skipped: 'no price from Valio' }
			])
		).toBe('2 out of stock at Valio; 1 no price from Valio');
	});

	it('places nothing while one item still needs an answer', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('1,000 L lactose-free milk and some cream by Monday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'partial'
		});
		expect(r.order).toBeNull();
		expect(r.unplaced?.map((u) => u.id)).toEqual(['cream']);
		expect(r.message).toMatch(/Nothing placed yet: cream still needs an answer/);
	}, 60_000);
});

describe('parse review (REVIEW=1)', () => {
	const milk = {
		query: 'lactose-free milk',
		qty: 1000,
		unit: 'l',
		constraints: ['lactose_free'],
		searchFi: ['maito']
	};
	const butter = { query: 'butter', qty: 5, unit: 'kg', constraints: [], searchFi: ['voi'] };

	it('a parse that drops a product is redone once with the critique', async () => {
		const { h, ctx, kitchen } = await setup();
		const prompts: string[] = [];
		const outs = [{ items: [milk] }, { items: [milk, butter] }];
		const llm: Llm = {
			generate: async (req) => {
				prompts.push(req.prompt);
				return {
					text: JSON.stringify(outs[prompts.length - 1]),
					model: 'gemini-test',
					tokens: { in: 1, out: 1 },
					latencyMs: 1
				};
			}
		};
		const r = await runRequest('1,000 L lactose-free milk and 5 kg butter by Monday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			place: false,
			llm,
			llmKind: 'gemini',
			review: {}
		});
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toMatch(/A reviewer found this.*"butter"/);
		expect(r.parsed.items.map((i) => i.product)).toEqual(['milk', 'butter']);
		expect(r.parsed.ambiguities.join()).not.toMatch(/review:/);
	}, 60_000);

	it('what is still wrong after the retry is shown, not hidden', async () => {
		const { h, ctx, kitchen } = await setup();
		const llm: Llm = {
			generate: async () => ({
				text: JSON.stringify({ items: [milk] }),
				model: 'gemini-test',
				tokens: { in: 1, out: 1 },
				latencyMs: 1
			})
		};
		const r = await runRequest('1,000 L lactose-free milk and 5 kg butter by Monday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			place: false,
			llm,
			llmKind: 'gemini',
			review: {}
		});
		expect(r.parsed.ambiguities.join()).toMatch(/review: .*"butter"/);
	}, 60_000);
});

describe('P1/P2: constraints in their own clause, Finnish cream words', () => {
	it('gives a constraint-only clause to the item before it', () => {
		const r = parseRules('We need 2 l milk, lactose free, for Thursday', TODAY);
		expect(r.items).toHaveLength(1);
		expect(r.items[0].constraints).toEqual(['lactose_free']);
		expect(r.items[0].query).toBe('lactose-free milk');
		expect(r.items[0].search[0]).toBe('maito laktoositon');
		expect(r.items[0].id).toBe('milk.lactose_free');
	});

	it('reads "vispikermaa" as cream and a trailing nominative "laktoositon"', () => {
		const r = parseRules('Vispikermaa 10 litraa perjantaiksi, laktoositon', TODAY);
		expect(r.items).toHaveLength(1);
		expect(r.items[0]).toMatchObject({ product: 'cream', qty: 10, unit: 'l' });
		expect(r.items[0].constraints).toEqual(['lactose_free']);
	});

	it('gives a leading constraint-only clause to the item after it', () => {
		const r = parseRules('lactose-free, 2 l milk by Thursday', TODAY);
		expect(r.items).toHaveLength(1);
		expect(r.items[0].constraints).toEqual(['lactose_free']);
	});
});

describe('core-physical-intent: /request sends the physical amount', () => {
	it('places a direct need sized by the server from the litres typed', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('2 l lactose-free milk by Thursday', {
			handlers: h,
			ctx,
			today: TODAY,
			kitchen,
			nonce: 'amount'
		});
		expect(r.order).toBeTruthy();
		const plan = r.order!.plan;
		expect(plan.needs.map((n) => n.amount)).toEqual([{ value: 2, unit: 'l' }]);
		expect(plan.lines[0].needId).toBe(plan.needs[0].id);
		// The preview's quantity is the quantity placed.
		const pick = r.lookup!.items[0].pick!;
		expect(plan.lines[0].qty.value).toBe((pick.conversion as { salesQty: number }).salesQty);
	});
});

describe('cut-off at lookup: a date whose ordering closed is said and an open one offered', () => {
	it('"for tomorrow" on Mon 21:40 asks for Wed 9 Dec, then orders for it when chosen', async () => {
		const { h, ctx, kitchen } = await setup();
		const base = {
			handlers: h,
			ctx,
			today: '2026-12-07',
			kitchen,
			now: new Date('2026-12-07T21:40:00+02:00'),
			nonce: 'cutoff'
		};
		const r = await runRequest('4 kg butter for tomorrow', base);
		expect(r.order).toBeNull();
		const it = r.lookup!.items[0];
		expect(it.pick).toBeNull();
		expect(it.question).toMatch(
			/^The cut-off for Tue 8 Dec has passed \(17:00 Mon\); earliest delivery is Wed 9 Dec\./
		);
		expect(it.answer).toMatchObject({ kind: 'date', date: '2026-12-09' });
		expect(r.parsed.deliverBy).toBe('2026-12-08'); // never moved silently

		const again = await runRequest('4 kg butter for tomorrow', {
			...base,
			deliverBy: '2026-12-09'
		});
		expect(again.order?.plan.deliverBy).toBe('2026-12-09');
		expect(again.parsed.notes.join()).toMatch(
			/delivery Wed 9 Dec: your choice; the request said Tue 8 Dec/
		);
	});
});

describe('cut-off before the case question', () => {
	it('"2 cases of butter tomorrow" after the cut-off offers the open date, not case sizes', async () => {
		const { h, ctx, kitchen } = await setup();
		const r = await runRequest('2 cases of butter tomorrow', {
			handlers: h,
			ctx,
			today: '2026-12-07',
			kitchen,
			now: new Date('2026-12-07T21:40:00+02:00')
		});
		expect(r.lookup!.items[0].answer).toMatchObject({ kind: 'date', date: '2026-12-09' });
	});
});
