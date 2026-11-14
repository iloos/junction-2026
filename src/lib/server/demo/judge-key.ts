/**
 * Judge keys (D9, `JudgeKeys` in core/ports.ts): stateless, one per visitor workspace.
 * `jk_<wsId>.<expiresEpochS>.<base64url HMAC-SHA256(JUDGE_KEY_SECRET, "jk|" + wsId + "|" + exp)>`, verified in
 * constant time. The key acts as an external agent (judge scopes: read, plan, order, never approve) in that
 * workspace's current run, so a reset keeps it working. Without JUDGE_KEY_SECRET judge keys are off.
 */
import type { JudgeKeys } from '$lib/core/ports';
import { hmac, sameText } from '$lib/server/auth/crypto';
import { isVisitorWorkspace, judgeSecret } from './visitor-id';

type Env = Record<string, string | undefined>;

/** Keys expire when the event does (override with JUDGE_KEY_EXPIRES, an ISO time). */
const DEFAULT_EXPIRY = '2026-11-16T00:00:00+02:00';

export const judgeKeysOn = (env: Env) => judgeSecret(env) !== null;

export function judgeKeyExpiry(env: Env): Date {
	const d = new Date(env.JUDGE_KEY_EXPIRES || DEFAULT_EXPIRY);
	return Number.isFinite(d.getTime()) ? d : new Date(DEFAULT_EXPIRY);
}

const KEY_RE = /^jk_(ws-j-[a-z0-9]+)\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export function createJudgeKeys(env: Env): JudgeKeys {
	return {
		mint(ws, expiresAt) {
			const secret = judgeSecret(env);
			if (!secret || !isVisitorWorkspace(ws)) return null;
			const exp = Math.floor(expiresAt.getTime() / 1000);
			return `jk_${ws}.${exp}.${hmac(secret, `jk|${ws}|${exp}`)}`;
		},
		verify(key, now) {
			const secret = judgeSecret(env);
			const m = secret ? KEY_RE.exec(key) : null;
			if (!secret || !m || !isVisitorWorkspace(m[1])) return null;
			const [, ws, exp, mac] = m;
			if (Number(exp) * 1000 <= now.getTime()) return null;
			return sameText(mac, hmac(secret, `jk|${ws}|${exp}`)) ? ws : null;
		}
	};
}

/** The judge key for a visitor workspace, expiring at the event's end; null when keys are off. */
export const judgeKeyFor = (ws: string, env: Env) =>
	createJudgeKeys(env).mint(ws, judgeKeyExpiry(env));

/** The workspace a judge key acts in, or null. */
export const verifyJudgeKey = (key: string | null | undefined, env: Env, now = new Date()) =>
	key ? createJudgeKeys(env).verify(key, now) : null;

/** The actor label a judge key shows in ops and traces: never the key, only a short workspace tag. */
export const judgeLabel = (ws: string) => `judge-${ws.slice(5, 11)}`;
