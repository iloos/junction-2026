/**
 * Need 8: the web tools through the public doors. A fresh MCP client with a judges' key sees them in
 * `tools/list` and runs `lookup_facts` on fixtures through the same gate as every tool; a cap or rate
 * limit is a 429 with a retry time.
 */
import { describe, expect, it } from 'vitest';
import { err, SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { handlers } from '../tools/handlers';
import { createMcpEndpoint } from '../tools/mcp';
import { retryAfterOf, serveTool } from '../tools/serve';

const JUDGE_KEY = 'judge-key-0123456789abcdef';
const handle = createMcpEndpoint(handlers, {
	env: { MCP_KEYS: `judge-1:external_agent:${JUDGE_KEY}` },
	dev: false
});

async function rpc(method: string, params: unknown = {}) {
	const res = await handle(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-06-18',
				authorization: `Bearer ${JUDGE_KEY}`
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		})
	);
	const text = await res.text();
	const data = text.startsWith('{')
		? JSON.parse(text)
		: JSON.parse(
				text
					.split('\n')
					.filter((l) => l.startsWith('data:'))
					.map((l) => l.slice(5))
					.pop() ?? 'null'
			);
	return { status: res.status, data };
}

describe('web tools on MCP (judge key, fixtures)', { timeout: 60_000 }, () => {
	it('a fresh client sees lookup_facts, find_outside and check_recall in tools/list', async () => {
		const r = await rpc('tools/list');
		expect(r.status).toBe(200);
		const names = r.data.result.tools.map((t: { name: string }) => t.name);
		expect(names).toEqual(expect.arrayContaining(['lookup_facts', 'find_outside', 'check_recall']));
	});

	it('lookup_facts runs through the gate on recorded answers, with sources and a [replay] label', async () => {
		const r = await rpc('tools/call', { name: 'lookup_facts', arguments: { productId: '460002' } });
		expect(r.status).toBe(200);
		const out = r.data.result.structuredContent;
		expect(r.data.result.isError).toBeFalsy();
		expect(out.facts.length).toBeGreaterThan(0);
		expect(out.facts.find((f: { field: string }) => f.field === 'ingredients')).toMatchObject({
			gtinCited: true,
			provenance: { source: 'web' }
		});
		expect(out.meta.summary).toMatch(/^\[replay\]/);
	});

	it('check_recall answers for a product without any network call', async () => {
		const r = await rpc('tools/call', { name: 'check_recall', arguments: { productId: '460002' } });
		expect(r.data.result.isError).toBeFalsy();
		expect(Array.isArray(r.data.result.structuredContent.notices)).toBe(true);
	});
});

describe('web limits on REST', () => {
	it('a daily cap is HTTP 429 with the seconds to wait', async () => {
		const capped = {
			lookup_facts: async () =>
				err('PROVIDER_UNAVAILABLE', 'exa daily per-key cap reached', {
					sub: 'daily_cap',
					detail: { api: 'exa', retryAfter: 3600 }
				})
		} as unknown as ToolHandlers;
		const ctx: CallContext = {
			workspaceId: 'ws-judges',
			runId: 'run-1',
			actor: { kind: 'external_agent', id: 'judge-1' },
			scopes: SCOPES_BY_ACTOR.external_agent,
			via: 'rest'
		};
		const r = await serveTool('lookup_facts', ctx, { productId: '460002' }, capped);
		expect(r).toMatchObject({
			ok: false,
			status: 429,
			error: { sub: 'daily_cap', retryable: true }
		});
		if (!r.ok) expect(retryAfterOf(r.error)).toBe(3600);
	});
});
