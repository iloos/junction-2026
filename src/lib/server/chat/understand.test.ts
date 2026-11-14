import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { SUPPORTED_EVENTS } from '$lib/server/agent/context';
import { resolveIntent } from '$lib/server/agent/intent';
import type { AgentContext } from '$lib/server/agent/types';
import { explain, unbacked } from './explain';
import { messyLlm } from './messy-replay';
import { understand } from './understand';
import type { TaskLedger } from '$lib/core/contracts/task';

const set = JSON.parse(
	readFileSync(join(process.cwd(), 'evals', 'agent', 'chat-messy.json'), 'utf-8')
) as {
	today: string;
	messages: {
		text: string;
		kind: string;
		order?: { qty: number; unit: string; deliverBy: string; constraint?: string };
	}[];
};

const ctx: AgentContext = {
	kitchens: [{ id: 'k-hotel', name: 'Hotel' }],
	currentPlan: null,
	openPlans: [],
	supportedEvents: SUPPORTED_EVENTS,
	supportedIntents: ['routine_order', 'seeded_event', 'shortage_repair', 'inspect'],
	today: set.today
};

/** A model that answers from a script and counts its calls. */
function model(replies: string[], name = 'gemini-test') {
	let calls = 0;
	const llm: Llm = {
		async generate() {
			return {
				text: replies[calls++] ?? '{}',
				model: name,
				tokens: { in: 1, out: 1 },
				latencyMs: 1
			};
		}
	};
	return { llm, calls: () => calls };
}

describe('suite: chat understanding · messy EN/FI messages (recorded Gemini readings)', () => {
	const llm = messyLlm();
	for (const m of set.messages)
		it(m.text, { timeout: 30_000 }, async () => {
			const u = await understand(m.text, { today: set.today, llm });
			expect(u.understanding.kind).toBe(m.kind);
			expect(u.source).toBe(m.kind === 'authority' ? 'rules' : 'gemini');
			if (!m.order) return;
			// The model's items run through /request's parser path into the same routine order.
			const r = resolveIntent(u.goal, ctx);
			expect(r).toMatchObject({
				kind: 'routine_order',
				qty: m.order.qty,
				unit: m.order.unit,
				deliverBy: m.order.deliverBy
			});
			if (m.order.constraint && r.kind === 'routine_order')
				expect(r.item.constraints).toContain(m.order.constraint);
		});
});

describe('the rules guard around the model', () => {
	it('authority is the rules call: the model is never asked', async () => {
		const m = model(['{"kind":"order","items":[{"product":"x","amount":1,"unit":"kg"}]}']);
		const u = await understand('approve everything for me', { today: set.today, llm: m.llm });
		expect(u.understanding.kind).toBe('authority');
		expect(m.calls()).toBe(0);
	});
	it('a question never becomes an order', async () => {
		const m = model(['{"kind":"order","items":[{"product":"butter","amount":4,"unit":"kg"}]}']);
		const u = await understand('Is 4 kg butter available tomorrow?', {
			today: set.today,
			llm: m.llm
		});
		expect(u.understanding.kind).toBe('read');
		expect(u.guard).toMatch(/stays a read/);
	});
	it('a stated amount the model drops is kept: the chef words run', async () => {
		const m = model(['{"kind":"order","items":[{"product":"butter","date":"tomorrow"}]}']);
		const u = await understand('4 kg butter tomorrow', { today: set.today, llm: m.llm });
		expect(u.goal).toBe('4 kg butter tomorrow');
		expect(u.guard).toMatch(/amount/);
	});
	it('a reply that fails the schema twice falls back to the rules, labelled', async () => {
		const m = model(['not json', '{"kind":"buy"}']);
		const u = await understand('4 kg butter tomorrow', { today: set.today, llm: m.llm });
		expect(m.calls()).toBe(2);
		expect(u).toMatchObject({ source: 'rules', guard: 'model reading unusable' });
		expect(u.understanding.kind).toBe('order');
	});
});

const ledger = (o: Partial<TaskLedger> = {}): TaskLedger => ({
	asOf: '2026-12-07T19:40:00.000Z',
	needs: [
		{
			needId: 'n1',
			planId: 'p',
			label: '60 kg butter',
			required: { value: 60, unit: 'kg' },
			supplierConfirmed: { value: 0, unit: 'kg' },
			awaitingSupplier: { value: 0, unit: 'kg' },
			plannedKnown: { value: 60, unit: 'kg' },
			plannedUnknown: { value: 0, unit: 'kg' },
			unresolved: { value: 0, unit: 'kg' },
			excess: { value: 0, unit: 'kg' }
		}
	],
	committedCents: 0,
	receiptIds: [],
	decisionsLeft: 1,
	nextAction: '1 held line waits for a chef in the Kitchen screen.',
	...o
});

describe('grounded answers: the claim check', () => {
	it('accepts what the ledger backs and rejects invented numbers or states', () => {
		expect(
			unbacked('60 kg of butter waits for your approval in the Kitchen screen.', ledger())
		).toBeNull();
		expect(unbacked('I ordered 60 kg of butter.', ledger())).toMatch(/ordered/);
		expect(unbacked('75 kg are planned.', ledger())).toMatch(/number 75/);
		expect(unbacked('60 kg is supplier confirmed.', ledger())).toMatch(/supplier confirmed/);
		expect(unbacked('Nothing is ordered yet, so it is not ordered.', ledger())).toBeNull();
	});
	it('uses the model text when it passes, the template when it does not', async () => {
		const good = await explain('what is left?', ledger(), 'TEMPLATE', {
			llm: model(['60 kg of butter is planned and waits for your approval in the Kitchen screen.'])
				.llm
		});
		expect(good).toMatchObject({ source: 'gemini' });
		const bad = await explain('what is left?', ledger(), 'TEMPLATE', {
			llm: model(['All 60 kg were ordered and supplier confirmed.']).llm
		});
		expect(bad).toMatchObject({ source: 'template', text: 'TEMPLATE' });
		expect((await explain('x', ledger(), 'TEMPLATE', {})).source).toBe('template');
	});
});
