import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SCOPES_BY_ACTOR, toolSchemas } from '$lib/core/contracts';
import { catchUp } from '$lib/server/bus';
import { currentRun } from '$lib/server/demo/run';
import { judgeKeyExpiry, judgeKeyFor, judgeKeysOn, judgeLabel } from '$lib/server/demo/judge-key';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { mcpInstructions, TITLES } from '$lib/server/tools/mcp';
import { toolsFor } from '$lib/server/tools/serve';
import type { PageServerLoad } from './$types';

/**
 * /agents: how an outside agent connects. The judge key is this browser's own (its visitor sandbox), minted by
 * G's JudgeKeys, so an agent and the kitchen screen in this browser work on the same plans. The tool list is
 * the registry as an external agent sees it: no approve, no mandate changes.
 */
export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const origin = event.url.origin;
	const v = await visitorWorkspace(event, env, dev, { follow: true });
	const on = judgeKeysOn(env);
	const key = on ? judgeKeyFor(v.workspaceId, env) : null;
	const external = {
		workspaceId: v.workspaceId,
		runId: '',
		actor: { kind: 'external_agent' as const, id: 'judge' },
		scopes: SCOPES_BY_ACTOR.external_agent,
		via: 'mcp'
	};
	const tools = toolsFor(external).map((name) => ({
		name,
		title: TITLES[name],
		scope: toolSchemas[name].scope,
		description: toolSchemas[name].description
	}));
	const mcpUrl = key ? `${origin}/mcp/k/${key}` : `${origin}/mcp`;
	return {
		workspaceId: v.workspaceId,
		calls: await yourCalls(v.workspaceId),
		configs: clientConfigs(mcpUrl),
		key,
		keyOff: !on
			? 'Judge keys are off on this server (JUDGE_KEY_SECRET is not set).'
			: !key
				? `${v.workspaceId} is not a visitor sandbox; open your own with ?ws=mine.`
				: null,
		expires: key ? judgeKeyExpiry(env).toISOString() : null,
		mcpUrl,
		openapiUrl: `${origin}/api/openapi.json`,
		kitchenUrl: `${origin}/`,
		instructions: mcpInstructions(tools.map((t) => t.name)),
		tools,
		withheld: (Object.keys(toolSchemas) as (keyof typeof toolSchemas)[])
			.filter((n) => !tools.some((t) => t.name === n))
			.map((n) => ({ name: n, scope: toolSchemas[n].scope }))
	};
};

/**
 * What an outside agent changed in this sandbox, newest first: the op log filtered to the external agent's writes
 * (reads write no op). The judge key's actor is `judge-<ws>`; every write it makes is an op with that actor.
 */
async function yourCalls(workspaceId: string) {
	try {
		const events = await catchUp(workspaceId, 0, 1000, currentRun(workspaceId));
		const label = judgeLabel(workspaceId);
		return events
			.flatMap((e) =>
				e.kind === 'op' && e.envelope.actor.kind === 'external_agent' ? [e.envelope] : []
			)
			.filter((o) => o.actor.id === label || o.actor.id.startsWith('judge'))
			.slice(-20)
			.reverse()
			.map((o) => ({ seq: o.seq, at: o.at, via: o.via, type: o.op.type }));
	} catch {
		return [];
	}
}

/** Copy-paste client configuration for the MCP URL: Claude Code, Claude Desktop (through mcp-remote) and generic. */
function clientConfigs(url: string) {
	return [
		{
			id: 'claude-code',
			label: 'Claude Code',
			text: `claude mcp add --transport http mandate ${url}`
		},
		{
			id: 'claude-desktop',
			label: 'Claude Desktop',
			text: JSON.stringify(
				{ mcpServers: { mandate: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
				null,
				2
			)
		},
		{
			id: 'generic',
			label: 'Any MCP client (Streamable HTTP)',
			text: JSON.stringify({ mcpServers: { mandate: { type: 'http', url } } }, null, 2)
		}
	];
}
