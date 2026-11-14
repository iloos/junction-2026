import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createMcpEndpoint } from './mcp';
import { serveTool } from './serve';
import { stubHandlers } from './stub-handlers';

/** R11-08: a tool that is not advertised is absent on the outside doors, and absent means no handler work at all. */
let calls = 0;
const handlers = {
	...stubHandlers,
	read_image: async () => {
		calls++;
		throw new Error('the handler must not run');
	}
} as unknown as ToolHandlers;
const handle = createMcpEndpoint(handlers, { env: {}, dev: true });

const ctx = (via: string): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind: 'external_agent', id: 'x' },
	scopes: ['read', 'plan', 'order'],
	via
});

let was: string | undefined;
beforeEach(() => {
	calls = 0;
	was = process.env.VISION_LIVE;
	delete process.env.VISION_LIVE;
});
afterEach(() => {
	if (was !== undefined) process.env.VISION_LIVE = was;
});

describe('R11-08: hidden tools do no work', () => {
	it('MCP tools/call of an unadvertised tool answers absent without running its handler', async () => {
		const res = await handle(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-06-18',
					authorization: 'Bearer fx-external-agent'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'read_image', arguments: { imageBase64: 'AAAA', mimeType: 'image/png' } }
				})
			})
		);
		const text = await res.text();
		expect(text).toMatch(/not found/i);
		expect(calls).toBe(0);
	});

	it('the REST and MCP doors refuse it as NOT_FOUND before any work; in process it still runs', async () => {
		for (const via of ['rest', 'mcp']) {
			const r = await serveTool('read_image', ctx(via), {}, handlers);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
		}
		expect(calls).toBe(0);
		// The in-app agent and /request reach every tool their scopes allow (fixture vision reads sample images).
		// (This fake input then fails validation: what matters is that it got past the door, so it isn't NOT_FOUND.)
		const inApp = await serveTool(
			'read_image',
			ctx('chat'),
			{ imageBase64: 'AAAA', mimeType: 'image/png' },
			handlers
		);
		expect(inApp.ok ? 'ok' : inApp.error.code).not.toBe('NOT_FOUND');
	});
});
