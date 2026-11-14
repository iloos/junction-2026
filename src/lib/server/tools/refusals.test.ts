import { describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { createJudgeKeys } from '$lib/server/demo/judge-key';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { newVisitorWorkspace } from '$lib/server/demo/visitor-id';
import { createServerPorts } from '$lib/server/store/server-ports';
import { realHandlers } from './handlers';
import { createMcpEndpoint } from './mcp';
import { recordRefusal, REFUSAL_WINDOW_MS } from './refusals';
import { serveTool } from './serve';

const env = { JUDGE_KEY_SECRET: 'a-test-secret-of-enough-length' };

async function mcpCall(
	handle: ReturnType<typeof createMcpEndpoint>,
	key: string,
	name: string,
	args: unknown
) {
	const res = await handle(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-06-18',
				authorization: `Bearer ${key}`
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args }
			})
		})
	);
	return { status: res.status, text: await res.text() };
}

describe('refused agent calls in the op log', () => {
	it('an outside agent approving through MCP with a judge key is refused and recorded once', async () => {
		const ws = newVisitorWorkspace();
		const runId = await ensureRunLoaded(ws, { start: true });
		const h = await realHandlers();
		const placed = await serveTool(
			'place_order',
			contextFor('kitchen_agent', 'agent', 'test', {}, ws),
			{
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-09',
				idempotencyKey: 'refusal-1',
				lines: [{ productId: '460692', qty: 3, unit: 'KI' }]
			},
			h
		);
		expect(placed.ok).toBe(true);
		const plan = placed.ok
			? (placed.value as { plan: { id: string; version: number } }).plan
			: null;

		const key = createJudgeKeys(env).mint(ws, new Date(Date.now() + 3_600_000))!;
		const handle = createMcpEndpoint(h, { env, dev: false });
		const args = {
			approvalId: 'ap-none',
			planVersion: plan!.version,
			termsHash: 'x',
			decision: 'grant'
		};
		const first = await mcpCall(handle, key, 'approve', args);
		expect(first.text).not.toContain('"approved"');
		await mcpCall(handle, key, 'approve', args);
		await mcpCall(handle, key, 'approve', args);

		const { store } = await createServerPorts();
		const s = await store.load(ws, runId);
		const refusals = s.refusals.filter((r) => r.tool === 'approve');
		expect(refusals).toHaveLength(1);
		expect(refusals[0]).toMatchObject({ code: 'FORBIDDEN', actor: { kind: 'external_agent' } });
		expect(s.plans[plan!.id].version).toBe(plan!.version);
	}, 60_000);

	it('REST answers 403 and records it; chefs and repeated calls within the window add nothing', async () => {
		const ws = newVisitorWorkspace();
		const runId = await ensureRunLoaded(ws, { start: true });
		const h = await realHandlers();
		const outside = contextFor('external_agent', 'judge', 'rest', {}, ws);
		const r = await serveTool('set_mandate', outside, { kitchenId: 'k-lounas' }, h);
		expect(r.ok ? 200 : r.status).toBe(403);

		const chef = contextFor('chef', 'chef', 'ui', {}, ws);
		/** An outside agent whose key lacks the order scope: its commit never reaches the handler. */
		const noOrder = { ...outside, scopes: outside.scopes.filter((x) => x !== 'order') };
		const error = { code: 'FORBIDDEN' as const, message: 'no', retryable: false };
		expect(await recordRefusal(chef, 'approve', {}, error)).toBe(false);
		// A commit the caller may make is already a failed CommitOrder in the log: not recorded twice.
		expect(await recordRefusal(outside, 'commit_order', { planId: 'pl-b' }, error)).toBe(false);
		const now = Date.now();
		expect(await recordRefusal(noOrder, 'commit_order', { planId: 'pl-a' }, error, now)).toBe(true);
		expect(
			await recordRefusal(noOrder, 'commit_order', { planId: 'pl-a' }, error, now + 1000)
		).toBe(false);
		expect(
			await recordRefusal(
				noOrder,
				'commit_order',
				{ planId: 'pl-a' },
				error,
				now + REFUSAL_WINDOW_MS
			)
		).toBe(true);

		const { store } = await createServerPorts();
		const s = await store.load(ws, runId);
		expect(s.refusals.map((x) => x.tool)).toEqual(['set_mandate', 'commit_order', 'commit_order']);
	}, 60_000);
});
