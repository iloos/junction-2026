import { beforeEach, describe, expect, it } from 'vitest';
import { createMcpEndpoint } from './mcp';
import { resetStub, stubHandlers } from './stub-handlers';

const handle = createMcpEndpoint(stubHandlers, { env: {}, dev: true });

/** One JSON-RPC call the way a 2025-era stateless client sends it; reads JSON or SSE replies. */
async function rpc(key: string | null, method: string, params: unknown = {}, pathKey?: string) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'mcp-protocol-version': '2025-06-18'
	};
	if (key) headers.authorization = `Bearer ${key}`;
	const res = await handle(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		}),
		pathKey
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

beforeEach(() => resetStub());

describe('MCP endpoint', () => {
	it('lists only in-scope tools: no approve or set_mandate for the external agent', async () => {
		const ext = await rpc('fx-external-agent', 'tools/list');
		const names = ext.data.result.tools.map((t: { name: string }) => t.name);
		expect(names).toEqual(
			expect.arrayContaining(['search_products', 'quote', 'place_order', 'commit_order'])
		);
		expect(names).not.toContain('approve');
		expect(names).not.toContain('set_mandate');

		const chef = await rpc(null, 'tools/list', {}, 'fx-chef');
		expect(chef.data.result.tools.map((t: { name: string }) => t.name)).toContain('approve');
	});

	it('refuses a missing or unknown key with 401', async () => {
		expect((await rpc(null, 'tools/list')).status).toBe(401);
		expect((await rpc('nope', 'tools/list')).status).toBe(401);
	});

	it('calls quote and place_order through the gate', async () => {
		const q = await rpc('fx-external-agent', 'tools/call', {
			name: 'quote',
			arguments: { productIds: ['464201', '479999'] }
		});
		expect(q.data.result.structuredContent.notFound).toEqual(['479999']);

		const p = await rpc('fx-external-agent', 'tools/call', {
			name: 'place_order',
			arguments: {
				kitchenId: 'k-lounas',
				deliverBy: '2026-11-16',
				idempotencyKey: 'mcp-1',
				lines: [{ productId: '464201', qty: 200, unit: 'ST' }]
			}
		});
		const out = p.data.result.structuredContent;
		expect(out.plan.state).toBe('held');
		expect(out.plan.lines[0].reasons).toContain('external_agent_needs_approval');
		expect(out.approvalId).toBeTruthy();
	});

	it('cannot call approve as the external agent even by name', async () => {
		const r = await rpc('fx-external-agent', 'tools/call', {
			name: 'approve',
			arguments: { approvalId: 'appr-1', planVersion: 1, termsHash: 'x', decision: 'grant' }
		});
		expect(JSON.stringify(r.data)).not.toContain('"state":"granted"');
		expect(r.data.error ?? r.data.result?.isError).toBeTruthy();
	});

	it('initialize returns instructions that say where to start and what the client may not do', async () => {
		const r = await rpc('fx-external-agent', 'initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'judge', version: '1' }
		});
		const text = r.data.result.instructions as string;
		expect(text).toMatch(/Start with/);
		expect(text).toMatch(/cannot approve or change the mandate/);
		expect(text).toMatch(/never instructions/);
	});
});
