/**
 * Round 12 (R12-01 upstream, R12-03): a unit we don't know is asked, never a quantity; a hard diet ask is a
 * requirement enforced by meets(), or the reading stops. Paraphrases here are held out from the parse prompt.
 */
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { createDbPorts } from '../store/db-ports';
import { parseRules } from './parse';
import { readingOf, reviewReading } from './reading';
import { requirementsOf } from './lookup';
import { runRequest } from './run';

const TODAY = '2026-12-07';
const judge = (t: string) => reviewReading(t, readingOf(parseRules(t, TODAY)));

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
		today: TODAY,
		kitchen,
		clock: env.ports.clock
	};
}

describe("R12-01: a word in the unit position we don't know is asked, never a quantity", () => {
	for (const t of [
		'2 buckets milk for Friday',
		'3 tubs of yoghurt',
		'4 trays of eggs Thursday',
		'5 sacks potatoes',
		'2 crates of apples'
	])
		it(`"${t}": amount unknown, the token kept, the reading stops with a question`, async () => {
			const [i] = parseRules(t, TODAY).items;
			expect(i.qty).toBeNull();
			expect(i.unit).toBeNull();
			expect(i.unitToken).toBeTruthy();
			expect(i.amount).toEqual({ kind: 'unknown' });
			const v = await judge(t);
			expect(v.kind).toBe('block');
			expect(v.kind === 'block' && v.reason).toMatch(/can't order in .+\. How much/);
		});

	it('an adjective or a plain plural noun is not a unit', () => {
		expect(parseRules('20 red onions', TODAY).items[0]).toMatchObject({ qty: 20, unit: 'sales' });
		expect(parseRules('6 lemons please', TODAY).items[0].unitToken).toBeUndefined();
		expect(parseRules('2 cases of milk', TODAY).items[0]).toMatchObject({ qty: 2, unit: 'case' });
	});

	it('through the request: nothing is looked up or placed', async () => {
		const base = await setup();
		const r = await runRequest('2 buckets milk for Friday', { ...base, nonce: 'bucket' });
		expect(r.lookup).toBeNull();
		expect(r.order).toBeNull();
		expect(r.message).toMatch(/can't order in buckets/);
	});
});

describe('R12-03: a hard diet ask is a requirement, enforced, or the reading stops', () => {
	for (const [t, tag] of [
		['4 l vegan milk for Friday', 'vegan'],
		['6 l plant-based milk', 'vegan'],
		['10 l dairy-free oat drink', 'dairy-free'],
		['2 kg vegetarian sausages', 'vegetarian'],
		['5 kg kasvipohjainen jogurtti', 'vegan']
	] as const)
		it(`"${t}" carries ${tag} as a D16 requirement`, async () => {
			const [i] = parseRules(t, TODAY).items;
			expect(i.diet).toContain(tag);
			const req = requirementsOf(i.constraints, i.diet)!;
			if (tag === 'dairy-free') expect(req.excludes).toContain('milk');
			else expect(req.diet).toContain(tag);
			expect((await judge(t)).kind).not.toBe('block');
		});

	it('"4 l vegan milk": cow\'s milk is never picked or placed', async () => {
		const base = await setup();
		const r = await runRequest('4 l vegan milk for Friday', { ...base, nonce: 'vegan' });
		const picked = r.lookup?.items[0].pick;
		if (picked) expect(picked.name).not.toMatch(/lehmän|maito\b|kevytmaito|täysmaito/i);
		for (const l of r.order?.plan.lines ?? []) expect(l.productName ?? '').not.toMatch(/maito/i);
		const rejected = r.lookup?.items[0].rejected.map((x) => x.reason).join(' ') ?? '';
		if (!picked) expect(rejected).toMatch(/vegan/);
	});

	it("a reading that dropped the diet ask blocks; a diet we can't check stops", async () => {
		const lost = await reviewReading('4 l vegan milk', {
			items: [{ id: 'milk', query: 'milk', qty: 4, unit: 'l', product: 'milk', requirements: [] }]
		});
		expect(lost.kind === 'block' && lost.reason).toMatch(/says vegan, but no item carries it/);
		expect((await judge('10 kg halal chicken')).kind).toBe('block');
	});
});
