import { describe, expect, it } from 'vitest';
import { ok } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { dueOf } from '$lib/core/mandate/due';
import { createGetContext } from '../agent/get-context';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import { createMcpEndpoint } from './mcp';
import { localTime, openDecisions } from './mcp-extras';
import { stubHandlers } from './stub-handlers';

const context = {
	actor: { kind: 'external_agent', id: 'fixture-external-agent' },
	scopes: ['read', 'plan', 'order'],
	workspaceId: 'ws-demo',
	scenario: {
		now: '2026-12-07T10:00:00Z',
		cutoff: '2026-12-08T15:00:00+02:00',
		delivery: '2026-12-10'
	},
	kitchens: [
		{
			id: 'k-hotel',
			name: 'Hotel Rautatientori (fictional)',
			events: [{ id: 'event-xmas-140', title: 'Christmas dinner buffet, 140 guests' }],
			deliveryDays: ['mon', 'wed', 'fri'],
			mandate: {
				version: 1,
				words: 'Order alone up to €800 a line.',
				lineCapCents: 80000,
				orderCapCents: 100000,
				weeklyCapCents: 400000,
				hardLimitCents: 800000,
				neverDelegate: ['new_sku'],
				allergenFreeFrom: [],
				tenderListOnly: false
			}
		}
	],
	openPlans: [{ planId: 'pl-1', version: 2, state: 'held', nextAction: 'A chef approves 3 lines.' }]
};

const handlers = { ...stubHandlers, get_context: async () => ok(context) } as ToolHandlers;
const handle = createMcpEndpoint(handlers, { env: {}, dev: true });

async function rpc(key: string, method: string, params: unknown = {}) {
	const res = await handle(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-06-18',
				authorization: `Bearer ${key}`
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		})
	);
	const text = await res.text();
	return JSON.parse(
		text.startsWith('{')
			? text
			: (text
					.split('\n')
					.filter((l) => l.startsWith('data:'))
					.map((l) => l.slice(5))
					.pop() ?? 'null')
	);
}

describe('MCP resources and prompts', () => {
	it('lists each kitchen’s mandate and reads it in words and numbers', async () => {
		const templates = await rpc('fx-external-agent', 'resources/templates/list');
		expect(
			templates.result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate)
		).toContain('mandate://{kitchen}');
		const list = await rpc('fx-external-agent', 'resources/list');
		const uris = list.result.resources.map((r: { uri: string }) => r.uri);
		expect(uris).toEqual(expect.arrayContaining(['mandate://k-hotel', 'decisions://open']));
		const read = await rpc('fx-external-agent', 'resources/read', { uri: 'mandate://k-hotel' });
		const text = read.result.contents[0].text as string;
		expect(text).toContain('“Order alone up to €800 a line.”');
		expect(text).toContain('€1,000 an order');
		expect(text).toContain('you cannot approve');
	});

	it('reads the open decisions with the next step and no approve affordance', async () => {
		const read = await rpc('fx-external-agent', 'resources/read', { uri: 'decisions://open' });
		const text = read.result.contents[0].text as string;
		expect(text).toContain('waiting for a chef');
		expect(text).toContain('A chef approves 3 lines.');
		expect(text).not.toMatch(/call approve|approve\(/i);
	});

	it('offers three prompts that keep the agent inside the mandate', async () => {
		const list = await rpc('fx-external-agent', 'prompts/list');
		expect(list.result.prompts.map((p: { name: string }) => p.name)).toEqual([
			'plan_event_in_mandate',
			'check_open_before_cutoff',
			'order_for_date'
		]);
		const got = await rpc('fx-external-agent', 'prompts/get', {
			name: 'order_for_date',
			arguments: { what: '4 kg butter', date: '2026-12-10' }
		});
		const body = got.result.messages[0].content.text as string;
		expect(body).toContain('deliveryDays');
		expect(body).toContain('Never try to approve');
	});
});

describe('decisions://open on a real plan', () => {
	it(
		'gives each plan its own due time from dueOf, in Helsinki words and ISO, never the scenario cut-off',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			w.env.ports.clock = { now: () => FIDELITY_NOW };
			const handlers = {
				...w.handlers,
				get_context: createGetContext(w.env.ports)
			} as ToolHandlers;
			const ctx = w.ctx('external_agent');
			const planned = await w.handlers.plan_event(ctx, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const body = await openDecisions(ctx, handlers);
			const got = await handlers.get_plan(ctx, { planId: planned.value.plan.id });
			if (!got.ok) throw new Error(got.error.message);
			const v = got.value;
			const due = dueOf(
				v.plan,
				v.approval ? { lineIds: v.approval.lineIds, expiresAt: v.approval.expiresAt ?? '' } : null,
				undefined,
				FIDELITY_NOW
			);
			expect(body).not.toContain('Order cut-off');
			// A planned event has open lines with Valio cut-offs, so something is due.
			expect(due).toBeTruthy();
			if (!due) return;
			expect(body).toContain(`(${due})`);
			expect(body).toContain(`Due ${localTime(due)}`);
			expect(localTime(due)).toMatch(/^\w{3} \d{1,2} \w{3} \d{2}:\d{2} Helsinki$/);
		}
	);
});
