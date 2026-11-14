import { describe, expect, it } from 'vitest';
import { ok } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { createMcpEndpoint } from './mcp';
import { absolutize, publicOrigin } from './present';
import { stubHandlers } from './stub-handlers';

describe('absolute links (D17: links point, only the human grants)', () => {
	it('prefers PUBLIC_ORIGIN, else the request origin', () => {
		expect(
			publicOrigin({ PUBLIC_ORIGIN: 'https://app.mandate.kitchen/' }, 'https://x.aiven.app/mcp')
		).toBe('https://app.mandate.kitchen');
		expect(publicOrigin({}, 'https://x.aiven.app/mcp/k/abc')).toBe('https://x.aiven.app');
		expect(publicOrigin({ PUBLIC_ORIGIN: 'not a url' }, 'http://localhost:5192/mcp')).toBe(
			'http://localhost:5192'
		);
	});

	it('makes every meta *Url path absolute and leaves the rest alone', () => {
		const v = absolutize(
			{
				plan: { id: 'p' },
				meta: {
					summary: 'see /not-a-link',
					approvalUrl: '/?kitchen=k-hotel&plan=p&v=2',
					reviewUrl: '/?menu=m&r=1',
					otherUrl: 'https://elsewhere.example/x',
					protocolRelativeUrl: '//evil.example'
				}
			},
			'https://app.mandate.kitchen'
		);
		expect(v.meta).toEqual({
			summary: 'see /not-a-link',
			approvalUrl: 'https://app.mandate.kitchen/?kitchen=k-hotel&plan=p&v=2',
			reviewUrl: 'https://app.mandate.kitchen/?menu=m&r=1',
			otherUrl: 'https://elsewhere.example/x',
			protocolRelativeUrl: '//evil.example'
		});
		expect(v.plan).toEqual({ id: 'p' });
		expect(absolutize({ products: [] }, 'https://a')).toEqual({ products: [] });
	});

	it('MCP results carry absolute links on PUBLIC_ORIGIN, not the internal host', async () => {
		const handlers = {
			...stubHandlers,
			search_products: async () =>
				ok({ products: [], meta: { summary: 'none', approvalUrl: '/?kitchen=k-hotel&plan=p&v=1' } })
		} as ToolHandlers;
		const handle = createMcpEndpoint(handlers, {
			env: { PUBLIC_ORIGIN: 'https://app.mandate.kitchen' },
			dev: true
		});
		const res = await handle(
			new Request('https://internal.aiven.app/mcp', {
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
					params: { name: 'search_products', arguments: { query: 'maito' } }
				})
			})
		);
		const text = await res.text();
		expect(text).toContain('https://app.mandate.kitchen/?kitchen=k-hotel&plan=p&v=1');
		expect(text).not.toContain('internal.aiven.app');
	});
});

describe('menu review link', () => {
	it('propose_menu carries meta.reviewUrl to that exact revision, beside the handler’s own summary', async () => {
		const { SCOPES_BY_ACTOR } = await import('$lib/core/contracts');
		const { createDbPorts } = await import('../store/db-ports');
		const { goldenBrief } = await import('../menu/golden');
		const { memoryMenuStore } = await import('../menu/store');
		const { proposeMenuHandler } = await import('../menu/tool');
		const { serveTool } = await import('./serve');
		const env = await createDbPorts();
		const h = {
			...stubHandlers,
			propose_menu: proposeMenuHandler({ ports: { ...env.ports, menus: memoryMenuStore() } })
		} as ToolHandlers;
		const r = await serveTool(
			'propose_menu',
			{
				workspaceId: 'ws-t',
				runId: 'r',
				actor: { kind: 'external_agent', id: 'k' },
				scopes: SCOPES_BY_ACTOR.external_agent,
				via: 'test'
			},
			{ kitchenId: 'k-hotel', brief: goldenBrief('christmas') },
			h
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const v = r.value as {
			proposal: { id: string; revision: number };
			meta?: Record<string, string>;
		};
		expect(v.meta?.reviewUrl).toBe(`/request?menu=${encodeURIComponent(v.proposal.id)}&rev=0`);
		expect(v.meta?.summary).toMatch(/nothing was planned or ordered/);
		expect(absolutize(v, 'https://app.mandate.kitchen').meta?.reviewUrl).toMatch(
			/^https:\/\/app\.mandate\.kitchen\/request\?menu=/
		);
	});
});
