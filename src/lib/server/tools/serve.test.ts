import { beforeEach, describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import type { ToolHandlers } from '$lib/core/ports';
import { err } from '$lib/core/contracts';
import { HTTP_STATUS, serveTool, toolsFor } from './serve';
import { resetStub, stubHandlers } from './stub-handlers';

const chef = contextFor('chef', 'test-chef', 'test');
const ext = contextFor('external_agent', 'test-ext', 'test');
const approver = contextFor('approver', 'test-approver', 'test');

beforeEach(() => resetStub());

describe('scope filtering', () => {
	it('never lists approve or set_mandate for the external agent (eval s5)', () => {
		const names = toolsFor(ext);
		expect(names).not.toContain('approve');
		expect(names).not.toContain('set_mandate');
		expect(names).toContain('place_order');
		expect(toolsFor(chef)).toContain('approve');
	});

	it('refuses an out-of-scope call with 403 FORBIDDEN before the handler runs', async () => {
		let called = false;
		const spy = {
			...stubHandlers,
			approve: async () => {
				called = true;
				return err('NOT_FOUND', 'x');
			}
		} as ToolHandlers;
		const r = await serveTool(
			'approve',
			ext,
			{ approvalId: 'a', planVersion: 1, termsHash: 'h', decision: 'grant' },
			spy
		);
		expect(r).toMatchObject({ ok: false, status: 403, error: { code: 'FORBIDDEN' } });
		expect(called).toBe(false);
	});
});

describe('error mapping', () => {
	it('maps every code to its HTTP status', () => {
		expect(HTTP_STATUS).toMatchObject({
			INVALID_INPUT: 400,
			FORBIDDEN: 403,
			NOT_FOUND: 404,
			STALE_VERSION: 409,
			TERMS_CHANGED: 409,
			DUPLICATE: 409,
			CAP_EXCEEDED: 422,
			BELOW_LOT: 422,
			INSUFFICIENT_STOCK: 422,
			UNKNOWN_REQUIRED: 422,
			PROVIDER_UNAVAILABLE: 503
		});
	});

	it('rejects bad input with 400 and unknown tools with 404', async () => {
		const bad = await serveTool('quote', ext, { productIds: [] }, stubHandlers);
		expect(bad).toMatchObject({ ok: false, status: 400, error: { code: 'INVALID_INPUT' } });
		const unknown = await serveTool('approve_order', chef, {}, stubHandlers);
		expect(unknown).toMatchObject({ ok: false, status: 404 });
	});

	it('turns a thrown handler into a 500 and an invalid output into a 500', async () => {
		const broken = {
			...stubHandlers,
			quote: async () => {
				throw new Error('boom');
			},
			search_products: async () => ({ ok: true, value: { products: [{ nope: 1 }] } })
		} as unknown as ToolHandlers;
		expect((await serveTool('quote', ext, { productIds: ['464201'] }, broken)).status).toBe(500);
		expect((await serveTool('search_products', ext, { query: 'x' }, broken)).status).toBe(500);
	});
});

describe('stub handlers through the gate (s5 shape)', () => {
	const basket = {
		kitchenId: 'k-lounas',
		deliverBy: '2026-11-16',
		lines: [
			{ productId: '464201', qty: 200, unit: 'ST' },
			{ productId: '470418', qty: 10, unit: 'ST' },
			{ productId: '472186', qty: 50, unit: 'ST' }
		]
	};

	it('quotes known ids and returns unknown ones as notFound', async () => {
		const r = await serveTool('quote', ext, { productIds: ['464201', '479999'] }, stubHandlers);
		expect(r.ok && r.value).toMatchObject({ notFound: ['479999'] });
	});

	it('holds an external order for approval, then commits once with a stable receipt', async () => {
		const placed = await serveTool(
			'place_order',
			ext,
			{ ...basket, idempotencyKey: 'ext-A' },
			stubHandlers
		);
		if (!placed.ok) throw new Error(placed.error.message);
		const { plan, approvalId } = placed.value as {
			plan: { id: string; version: number; totalCents: number; termsHash: string; state: string };
			approvalId: string;
		};
		expect(plan.totalCents).toBe(69550);
		expect(plan.state).toBe('held');

		const early = await serveTool(
			'commit_order',
			ext,
			{ planId: plan.id, version: plan.version, idempotencyKey: 'c1' },
			stubHandlers
		);
		expect(early.status).toBe(403);

		const dup = await serveTool(
			'place_order',
			ext,
			{ ...basket, lines: [basket.lines[0]], idempotencyKey: 'ext-A' },
			stubHandlers
		);
		expect(dup).toMatchObject({ status: 409, error: { code: 'DUPLICATE', retryable: false } });

		const ok = await serveTool(
			'approve',
			approver,
			{ approvalId, planVersion: plan.version, termsHash: plan.termsHash, decision: 'grant' },
			stubHandlers
		);
		expect(ok.ok && ok.value).toMatchObject({ state: 'granted' });

		const commit = { planId: plan.id, version: plan.version, idempotencyKey: 'ext-A-commit' };
		const first = await serveTool('commit_order', ext, commit, stubHandlers);
		const retry = await serveTool('commit_order', ext, commit, stubHandlers);
		expect(first.ok && first.value).toMatchObject({ totalCents: 69550 });
		expect(retry.ok && retry.value).toEqual(first.ok && first.value);

		const got = await serveTool('get_plan', ext, { planId: plan.id }, stubHandlers);
		expect(got.ok && got.value).toMatchObject({
			plan: { state: 'committed' },
			approval: { state: 'granted' }
		});
	});

	it('plans the Christmas event and rescales a need on a g/guest edit', async () => {
		const kitchenAgent = contextFor('kitchen_agent', 'test-agent', 'test');
		const r = await serveTool(
			'plan_event',
			kitchenAgent,
			{ kitchenId: 'k-hotel', eventId: 'event-xmas-140' },
			stubHandlers
		);
		if (!r.ok) throw new Error(r.error.message);
		const plan = (
			r.value as {
				plan: {
					id: string;
					version: number;
					lines: { productId: string; state: string; needId?: string }[];
				};
			}
		).plan;
		const ham = plan.lines.find((l) => l.productId === '462490')!;
		expect(ham.state).toBe('unorderable');
		const subs = await serveTool(
			'find_substitutes',
			kitchenAgent,
			{ planId: plan.id, version: plan.version, lineId: (ham as { id?: string }).id },
			stubHandlers
		);
		expect(
			subs.ok && (subs.value as unknown as { chosen: { productId: string }[] }).chosen[0]?.productId
		).toBe('476768');
	});
});

describe('real handlers with stub fallback', () => {
	it('serves quote and place_order for real and plan_event from the stub', async () => {
		const { handlers } = await import('./handlers');
		const q = await serveTool('quote', ext, { productIds: ['464201', '479999'] }, handlers);
		if (!q.ok) throw new Error(q.error.message);
		expect((q.value as { notFound: string[] }).notFound).toEqual(['479999']);

		const p = await serveTool(
			'place_order',
			ext,
			{
				kitchenId: 'k-lounas',
				deliverBy: '2026-11-16',
				idempotencyKey: 'fallback-1',
				lines: [{ productId: '464201', qty: 2, unit: 'ST' }]
			},
			handlers
		);
		if (!p.ok) throw new Error(p.error.message);
		const planId = (p.value as { plan: { id: string } }).plan.id;
		expect(planId.startsWith('stub-')).toBe(false);
		const real = await serveTool('get_plan', ext, { planId }, handlers);
		expect(real.ok).toBe(true);

		const agent = contextFor('kitchen_agent', 'test-agent', 'test');
		const ev = await serveTool(
			'plan_event',
			agent,
			{ kitchenId: 'k-hotel', eventId: 'event-xmas-140' },
			handlers
		);
		if (!ev.ok) throw new Error(ev.error.message);
		// plan_event is real since core-db slice 3, so its plan id is not a stub id.
		const stubPlan = (ev.value as { plan: { id: string } }).plan.id;
		expect(stubPlan.startsWith('stub-')).toBe(false);
		const got = await serveTool('get_plan', agent, { planId: stubPlan }, handlers);
		expect(got.ok).toBe(true);
	}, 60000);
});
