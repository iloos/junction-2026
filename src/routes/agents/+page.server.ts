import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SCOPES_BY_ACTOR, toolSchemas, type Op, type OpEnvelope } from '$lib/core/contracts';
import { opSummary, type Names } from '../ops/labels';
import { catchUp } from '$lib/server/bus';
import { currentRun } from '$lib/server/demo/run';
import { judgeKeyExpiry, judgeKeyFor, judgeKeysOn, judgeLabel } from '$lib/server/demo/judge-key';
import { roomNotice, visitorWorkspace } from '$lib/server/demo/visitor';
import { mcpInstructions, TITLES } from '$lib/server/tools/mcp';
import { MCP_PROMPTS, MCP_RESOURCES } from '$lib/server/tools/mcp-extras';
import { toolsFor } from '$lib/server/tools/serve';
import type { PageServerLoad } from './$types';

/** Why there is no key here: only your own sandbox gets one, so an agent never acts in a room others share. */
const NO_KEY_HERE =
	'An outside agent gets a key only in your own sandbox, never in a shared room. Open your sandbox to connect one.';

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
		/** For the header: which room this page shows. */
		room: { notice: roomNotice(v), workspaceId: v.workspaceId },
		calls: await yourCalls(v.workspaceId),
		after: await lastSeq(v.workspaceId),
		configs: clientConfigs(mcpUrl),
		key,
		keyOff: !on
			? 'Judge keys are off on this server (JUDGE_KEY_SECRET is not set).'
			: !key
				? NO_KEY_HERE
				: null,
		expires: key ? judgeKeyExpiry(env).toISOString() : null,
		mcpUrl,
		openapiUrl: `${origin}/api/openapi.json`,
		agentCardUrl: `${origin}/.well-known/agent.json`,
		resources: MCP_RESOURCES,
		prompts: MCP_PROMPTS,
		kitchenUrl: `${origin}/`,
		instructions: mcpInstructions(tools.map((t) => t.name)),
		tools
	};
};

/**
 * What an outside agent changed in this sandbox, newest first: the op log filtered to this key's writes and
 * refusals (reads write no op), each in one plain sentence. The judge key's actor is `judge-<ws>`.
 */
async function yourCalls(workspaceId: string) {
	try {
		const events = await catchUp(workspaceId, 0, 1000, currentRun(workspaceId));
		const label = judgeLabel(workspaceId);
		const ours = events.flatMap((e) =>
			e.kind === 'op' && e.envelope.actor.kind === 'external_agent' && e.envelope.actor.id === label
				? [e.envelope]
				: []
		);
		const names = namesIn(ours);
		return (
			ours
				// A commit the gate refused is logged twice (the failed order and the refusal); the refusal says it.
				.filter(
					(o) =>
						!(
							o.op.type === 'CommitOrder' &&
							o.op.outcome.result === 'failed' &&
							o.op.outcome.error.code === 'FORBIDDEN'
						)
				)
				.slice(-20)
				.reverse()
				.map((o) => ({ seq: o.seq, at: o.at, text: opSummary(o, names), tone: toneOf(o.op) }))
		);
	} catch {
		return [];
	}
}

/** The newest op sequence in this sandbox, so the page's live stream starts after what it already shows. */
async function lastSeq(workspaceId: string) {
	try {
		const events = await catchUp(workspaceId, 0, 1000, currentRun(workspaceId));
		return events.reduce((m, e) => (e.kind === 'op' ? Math.max(m, e.envelope.seq) : m), 0);
	} catch {
		return 0;
	}
}

type Tone = 'plan' | 'order' | 'refused' | 'note';

/** The icon a change gets on the panel; its sentence is /ops' own (`opSummary`), so op words have one source. */
function toneOf(op: Op): Tone {
	switch (op.type) {
		case 'CommitOrder':
			return op.outcome.result === 'committed' ? 'order' : 'refused';
		case 'RecordRefusal':
			return 'refused';
		case 'RecordAnomaly':
		case 'RecordEnrichment':
		case 'RecordApproval':
			return 'note';
		default:
			return 'plan';
	}
}

/** Product names the ops carry on their lines, for `opSummary` (no catalogue read). */
function namesIn(ops: OpEnvelope[]): Names {
	const names: Names = {};
	for (const { op } of ops) {
		const lines =
			op.type === 'CreatePlan'
				? op.plan.lines
				: op.type === 'RecordOffer' || op.type === 'ProposeSubstitute'
					? op.lines
					: [];
		for (const l of lines) if (l.productName) names[l.productId] = l.productName;
	}
	return names;
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
