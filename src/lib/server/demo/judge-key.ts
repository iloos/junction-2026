/**
 * Judge keys (T0): stateless, one per visitor workspace. The key is `<wsId>.<base64url(HMAC-SHA256(secret, wsId))>`,
 * so the server needs no key table: it recomputes the MAC and compares in constant time. The key acts as an
 * external agent (the judges' MCP_KEYS scopes: no approve) in that workspace only. Without JUDGE_KEY_SECRET,
 * judge keys are off: none are minted and none verify.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isVisitorWorkspace } from './visitor-id';

type Env = Record<string, string | undefined>;

/** Shorter secrets are treated as unset, so an env typo can't open the door. */
const MIN_SECRET = 16;

const secretOf = (env: Env) => {
	const s = env.JUDGE_KEY_SECRET?.trim();
	return s && s.length >= MIN_SECRET ? s : null;
};

export const judgeKeysOn = (env: Env) => secretOf(env) !== null;

const mac = (secret: string, ws: string) =>
	createHmac('sha256', secret).update(`judge:${ws}`).digest('base64url');

/** The judge key for a visitor workspace, or null when judge keys are off or the id isn't a visitor's. */
export function judgeKeyFor(workspaceId: string, env: Env): string | null {
	const secret = secretOf(env);
	if (!secret || !isVisitorWorkspace(workspaceId)) return null;
	return `${workspaceId}.${mac(secret, workspaceId)}`;
}

/** The workspace a judge key acts in, or null if it isn't a valid judge key. */
export function verifyJudgeKey(key: string | null | undefined, env: Env): string | null {
	const secret = secretOf(env);
	if (!secret || !key) return null;
	const dot = key.lastIndexOf('.');
	if (dot < 0) return null;
	const ws = key.slice(0, dot);
	if (!isVisitorWorkspace(ws)) return null;
	const given = Buffer.from(key.slice(dot + 1));
	const want = Buffer.from(mac(secret, ws));
	return given.length === want.length && timingSafeEqual(given, want) ? ws : null;
}

/** The actor label a judge key shows in ops and traces: never the key, only a short workspace tag. */
export const judgeLabel = (ws: string) => `judge-${ws.slice(5, 11)}`;
