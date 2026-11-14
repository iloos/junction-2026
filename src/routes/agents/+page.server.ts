import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SCOPES_BY_ACTOR, toolSchemas, type Op } from '$lib/core/contracts';
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
		after: await lastSeq(v.workspaceId),
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
 * What an outside agent changed in this sandbox, newest first: the op log filtered to this key's writes and
 * refusals (reads write no op), each in one plain sentence. The judge key's actor is `judge-<ws>`.
 */
async function yourCalls(workspaceId: string) {
	try {
		const events = await catchUp(workspaceId, 0, 1000, currentRun(workspaceId));
		const label = judgeLabel(workspaceId);
		return (
			events
				.flatMap((e) =>
					e.kind === 'op' &&
					e.envelope.actor.kind === 'external_agent' &&
					e.envelope.actor.id === label
						? [e.envelope]
						: []
				)
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
				.map((o) => ({ seq: o.seq, at: o.at, ...opWords(o.op) }))
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

const euros = (cents: number) =>
	(cents / 100).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });
const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
const day = (iso: string) =>
	new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/Helsinki'
	});

/** One op in the words a chef reads (VOCABULARY): no op names, no ids. */
function opWords(op: Op): { text: string; tone: Tone } {
	switch (op.type) {
		case 'CreatePlan':
			return {
				tone: 'plan',
				text: `Started a plan ${op.plan.eventId ? 'for the event' : 'for an order'}, delivery ${day(op.plan.deliverBy)}.`
			};
		case 'EditLine':
			return { tone: 'plan', text: `Changed the plan: ${op.summary}.` };
		case 'RecordOffer': {
			const held = op.lines.filter((l) => l.state === 'held').length;
			return {
				tone: 'plan',
				text:
					`Got Valio's live prices: ${euros(op.totalCents)} in all` +
					(held ? `; ${lines(held)} wait for a chef.` : '; the mandate allows every line.')
			};
		}
		case 'ProposeSubstitute': {
			if (op.kind === 'make_in_house')
				return { tone: 'plan', text: 'Proposed making it in house from orderable ingredients.' };
			const pick = op.lines[0];
			return pick
				? {
						tone: 'plan',
						text: `Proposed ${pick.productName ?? 'a substitute'} instead, out of ${op.candidates.length} weighed.`
					}
				: {
						tone: 'note',
						text: `Looked for a substitute; none of ${op.candidates.length} qualified.`
					};
		}
		case 'CommitOrder':
			return op.outcome.result === 'committed'
				? {
						tone: 'order',
						text: `Placed an order: ${lines(op.outcome.order.lines.length)}, ${euros(op.outcome.order.totalCents)}.`
					}
				: { tone: 'refused', text: `Tried to place an order: ${op.outcome.error.message}.` };
		case 'RecordRefusal':
			return {
				tone: 'refused',
				text:
					op.tool === 'approve'
						? 'Tried to approve: refused. Only a chef approves.'
						: op.tool === 'set_mandate'
							? 'Tried to change the mandate: refused. Only a chef changes it.'
							: op.sub === 'approval_required'
								? 'Tried to order lines that wait for a chef: refused until a chef approves.'
								: 'Asked for something the mandate does not allow: refused.'
			};
		case 'RecordAnomaly':
			return { tone: 'note', text: `Flagged: ${op.anomaly.message}` };
		case 'RecordEnrichment':
			return { tone: 'note', text: 'Noted a product fact, as a suggestion with its source.' };
		case 'RecordApproval': {
			const n = lines(op.approval.lineIds.length);
			return op.approval.state === 'pending'
				? { tone: 'note', text: `Asked a chef to approve ${n} the mandate holds.` }
				: { tone: 'note', text: `The approval for ${n} is now ${op.approval.state}.` };
		}
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
