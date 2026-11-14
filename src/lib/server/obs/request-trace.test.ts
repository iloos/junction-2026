import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFixtureDb } from '../db/pglite';
import type { AnyDb } from '../store/drizzle-store';
import { withRequest } from './context';
import { createTraceStore, type TraceStore } from './trace-store';
import { flushTraces, setTraceStore } from './traces';

// The live Gemini text client, faked at the provider edge: the router, its outside-call wrapper, the spend guard
// and the trace path all run for real.
vi.mock('../adapters/llm/index', async (orig) => {
	const real = await orig<typeof import('../adapters/llm/index')>();
	return {
		...real,
		geminiLlm: (_key: string, _trace: unknown, model: string) => ({
			generate: async () => ({
				text: '{"items":[{"text":"10 kg butter","query":"butter","qty":10,"unit":"kg"}]}',
				model,
				tokens: { in: 321, out: 45 },
				latencyMs: 7
			})
		})
	};
});

let store: TraceStore;

beforeAll(async () => {
	// Nothing in this test may reach the network: any other live client fails fast and is traced as an error.
	vi.stubGlobal('fetch', async () => {
		throw new Error('network off in tests');
	});
	const { db } = await createFixtureDb();
	store = createTraceStore(db as unknown as AnyDb);
	setTraceStore(store);
});

afterAll(() => {
	setTraceStore(null);
	vi.unstubAllGlobals();
});

describe('one /request run, traced end to end', () => {
	it('stores its model call and its tool calls under one request id and workspace', async () => {
		const { submitRequest } = await import('../request');
		const { resolveRequest } = await import('../auth');
		const env = {
			LLM_PROVIDER: 'gemini',
			GEMINI_API_KEY: 'test-key-not-real',
			DECIDE_LIVE: '0'
		};
		const ctx = resolveRequest(
			new Request('http://x/api/request', { headers: { authorization: 'Bearer fx-chef' } }),
			env,
			{ dev: true, via: 'rest:request' }
		)!;
		expect(ctx).toBeTruthy();

		await withRequest({ requestId: 'req-e2e-1', method: 'POST', route: '/api/request' }, () =>
			submitRequest({ text: '10 kg butter for Friday', place: false, env, ctx }).catch(() => null)
		);
		await flushTraces();

		const rows = await store.list({ requestId: 'req-e2e-1', limit: 500 });
		const gemini = rows.filter((r) => r.source === 'gemini');
		expect(gemini.length).toBeGreaterThan(0);
		expect(gemini[0]).toMatchObject({
			requestId: 'req-e2e-1',
			workspaceId: ctx.workspaceId,
			cache: 'live',
			ok: true,
			tokensIn: 321,
			tokensOut: 45
		});
		expect(gemini[0].model).toBeTruthy();
		// The wrapped provider adapter does not add a second row for the same call.
		expect(gemini).toHaveLength(
			new Set(gemini.map((r) => (r.data as { job?: string })?.job ?? r.id)).size
		);

		const tools = rows.filter((r) => r.source === 'tool');
		expect(tools.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(r.requestId).toBe('req-e2e-1');
			expect(r.workspaceId).toBe(ctx.workspaceId);
		}
		// Visible to the Ops read, which filters by workspace.
		const summary = await store.summary({ workspaceId: ctx.workspaceId });
		expect(summary.map((s) => s.source)).toEqual(expect.arrayContaining(['gemini', 'tool']));
	}, 60_000);

	it('an outside call made before any tool names the workspace still lands in it', async () => {
		const { reportExternal } = await import('../external/call');
		const { inWorkspace } = await import('../adapters/simulator/overlay');
		const { annotateRequest } = await import('./context');
		await withRequest({ requestId: 'req-e2e-2' }, async () => {
			// A Valio lookup with no call scope (the live catalogue's onCall): no workspace on the trace itself.
			reportExternal(() => {}, 'tool', {
				api: 'valio',
				purpose: 'offers',
				cache: 'live',
				ok: true,
				latencyMs: 40
			});
			// One inside a workspace scope but without an external scope (the /request parse path).
			await inWorkspace('ws-demo', async () =>
				reportExternal(() => {}, 'tool', {
					api: 'exa',
					purpose: 'facts',
					cache: 'cache',
					ok: true,
					latencyMs: 0
				})
			);
			// The request learns its workspace later (its first tool call).
			annotateRequest({ workspaceId: 'ws-demo', runId: 'run-1' });
		});
		await flushTraces();
		const rows = await store.list({ requestId: 'req-e2e-2', workspaceId: 'ws-demo' });
		expect(rows.map((r) => r.source).sort()).toEqual(['exa', 'valio']);
	});
});
