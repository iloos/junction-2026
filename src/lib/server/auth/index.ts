import { SCOPES_BY_ACTOR, type ActorKind } from '$lib/core/contracts';
import { currentRun } from '$lib/server/demo/run';
import { judgeLabel, verifyJudgeKey } from '$lib/server/demo/judge-key';
import type { CallContext } from '$lib/core/ports';

/**
 * Bearer key → CallContext (D6). The actor, workspace, run and scopes come only from the key table,
 * never from the request body. Keys arrive as `Authorization: Bearer <key>` or in the MCP path
 * `/mcp/k/<key>` (claude.ai custom connectors cannot send headers reliably).
 *
 * Key sources, all read from the server env:
 * - `MANDATE_KEY_CHEF`, `MANDATE_KEY_KITCHEN_AGENT`, `MANDATE_KEY_EXTERNAL_AGENT`, `MANDATE_KEY_APPROVER`
 * - `MCP_KEYS="label:actor:key,…"` for extra keys, e.g. one external_agent key per judge
 * - judge keys `<ws-j-id>.<hmac>` minted per visitor sandbox from `JUDGE_KEY_SECRET` (server/demo/judge-key.ts)
 * - `MANDATE_WORKSPACE` / `MANDATE_RUN` (default `ws-demo` / `run-1`)
 * - fixture keys (`fx-chef`, …, public in this repo) only in dev or with `MANDATE_FIXTURE_KEYS=1`
 */
export type Env = Record<string, string | undefined>;

export interface KeyEntry {
	key: string;
	actor: ActorKind;
	/** Shown as the actor id in ops and traces; the key itself is never logged. */
	label: string;
	/** Workspace the key acts in; default the stage workspace (MANDATE_WORKSPACE or ws-demo). */
	workspaceId?: string;
}

/** Judges' MCP keys act in their own sandbox so they can't disturb the stage run. */
export const JUDGES_WORKSPACE = 'ws-judges';

export const FIXTURE_KEYS: readonly KeyEntry[] = [
	{ key: 'fx-chef', actor: 'chef', label: 'fixture-chef' },
	{ key: 'fx-kitchen-agent', actor: 'kitchen_agent', label: 'fixture-kitchen-agent' },
	{ key: 'fx-external-agent', actor: 'external_agent', label: 'fixture-external-agent' },
	{ key: 'fx-approver', actor: 'approver', label: 'fixture-approver' }
];

const ENV_KEYS: readonly [string, ActorKind][] = [
	['MANDATE_KEY_CHEF', 'chef'],
	['MANDATE_KEY_KITCHEN_AGENT', 'kitchen_agent'],
	['MANDATE_KEY_EXTERNAL_AGENT', 'external_agent'],
	['MANDATE_KEY_APPROVER', 'approver']
];

/** Only actors a key may carry. `system` and `job` are internal and get their context in code. */
const KEYED_ACTORS: readonly ActorKind[] = ['chef', 'kitchen_agent', 'external_agent', 'approver'];

/** Keys shorter than this are refused, so an env typo like `MANDATE_KEY_CHEF=x` cannot open the gate. */
const MIN_KEY_LENGTH = 16;

export function keyTable(env: Env, opts: { dev: boolean }): KeyEntry[] {
	const out: KeyEntry[] = [];
	for (const [name, actor] of ENV_KEYS) {
		const key = env[name]?.trim();
		if (key && key.length >= MIN_KEY_LENGTH)
			out.push({ key, actor, label: actor.replace('_', '-') });
	}
	for (const item of (env.MCP_KEYS ?? '').split(',')) {
		// label:actor:key[:workspace]; MCP_KEYS entries default to the judges' sandbox.
		const [label, actor, key, workspaceId] = item.trim().split(':');
		if (!label || !key || key.length < MIN_KEY_LENGTH) continue;
		if (!(KEYED_ACTORS as readonly string[]).includes(actor)) continue;
		out.push({
			key,
			actor: actor as ActorKind,
			label,
			workspaceId: workspaceId || JUDGES_WORKSPACE
		});
	}
	if (opts.dev || env.MANDATE_FIXTURE_KEYS === '1') out.push(...FIXTURE_KEYS);
	return out;
}

/** Builds the context for a known actor. Used for keys and for in-process callers (the routine agent). */
export function contextFor(
	actor: ActorKind,
	label: string,
	via: string,
	env: Env = {},
	workspaceId: string = env.MANDATE_WORKSPACE || 'ws-demo'
): CallContext {
	return {
		workspaceId,
		runId: env.MANDATE_RUN || currentRun(workspaceId),
		actor: { kind: actor, id: label },
		scopes: SCOPES_BY_ACTOR[actor],
		via
	};
}

export function resolveKey(
	key: string | null | undefined,
	env: Env,
	opts: { dev: boolean; via: string }
): CallContext | null {
	if (!key) return null;
	// Judge keys (HMAC of a visitor workspace, JUDGE_KEY_SECRET): an external agent in that sandbox only.
	const judgeWs = verifyJudgeKey(key, env);
	if (judgeWs) return contextFor('external_agent', judgeLabel(judgeWs), opts.via, env, judgeWs);
	const entry = keyTable(env, opts).find((e) => timingSafeEqual(e.key, key));
	return entry ? contextFor(entry.actor, entry.label, opts.via, env, entry.workspaceId) : null;
}

export function bearerFrom(request: Request): string | null {
	const h = request.headers.get('authorization');
	const m = h?.match(/^Bearer\s+(\S+)\s*$/i);
	return m ? m[1] : null;
}

/** Header first, then the path key. */
export function resolveRequest(
	request: Request,
	env: Env,
	opts: { dev: boolean; via: string; pathKey?: string }
): CallContext | null {
	return resolveKey(bearerFrom(request) ?? opts.pathKey, env, opts);
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
