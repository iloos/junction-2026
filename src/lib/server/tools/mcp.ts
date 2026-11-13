import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { toolSchemas, type ToolName } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { resolveRequest, type Env } from '$lib/server/auth';
import { CORS, unauthorized, withCors } from './http';
import { serveTool, toolsFor } from './serve';

/**
 * Stateless MCP (streamable HTTP, SDK v2): a fresh server per request, built for the caller's context.
 * Only tools inside the caller's scopes are registered, so an external agent's `tools/list` has no
 * `approve` or `set_mandate` at all (eval s5). Every call goes through `serveTool`, like REST.
 */
const TITLES: Record<ToolName, string> = {
	search_products: 'Search products',
	quote: 'Quote live terms',
	plan_event: 'Plan an event',
	place_order: 'Place an order (goes through the mandate)',
	edit_line: 'Edit a line or need',
	find_substitutes: 'Find substitutes',
	get_plan: 'Get a plan',
	explain_line: 'Explain a line',
	approve: 'Approve or deny',
	commit_order: 'Commit an order',
	set_mandate: 'Change the mandate'
};

export function buildMcpServer(ctx: CallContext, handlers: ToolHandlers): McpServer {
	const server = new McpServer({ name: 'mandate', version: '0.1.0' });
	for (const name of toolsFor(ctx)) {
		const t = toolSchemas[name];
		server.registerTool(
			name,
			{
				title: TITLES[name],
				description: t.description,
				inputSchema: t.input,
				outputSchema: t.output,
				annotations: {
					readOnlyHint: t.scope === 'read',
					destructiveHint: false,
					idempotentHint: name === 'place_order' || name === 'commit_order' || t.scope === 'read',
					openWorldHint: name === 'quote'
				}
			},
			async (args: unknown): Promise<CallToolResult> => {
				const r = await serveTool(name, ctx, args, handlers);
				if (!r.ok)
					return {
						isError: true,
						content: [{ type: 'text', text: JSON.stringify({ error: r.error }) }]
					};
				const value = r.value as Record<string, unknown>;
				return {
					content: [{ type: 'text', text: JSON.stringify(value) }],
					structuredContent: value
				};
			}
		);
	}
	return server;
}

export function createMcpEndpoint(handlers: ToolHandlers, opts: { env: Env; dev: boolean }) {
	const mcp = createMcpHandler(
		({ authInfo }) => buildMcpServer(authInfo?.extra?.ctx as CallContext, handlers),
		{ responseMode: 'json', onerror: (e) => console.error('[mcp]', e.message) }
	);
	return async (request: Request, pathKey?: string): Promise<Response> => {
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
		const ctx = resolveRequest(request, opts.env, { dev: opts.dev, via: 'mcp', pathKey });
		if (!ctx) return unauthorized();
		const res = await mcp.fetch(request, {
			authInfo: {
				token: 'redacted',
				clientId: ctx.actor.id,
				scopes: [...ctx.scopes],
				extra: { ctx }
			}
		});
		return withCors(res);
	};
}
