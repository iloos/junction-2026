/**
 * Chef keys (D22): the chef's own AI client, paired from the browser that owns the sandbox. Stateless like judge
 * keys: `ck_<wsId>.<expiresEpochS>.<base64url HMAC-SHA256(JUDGE_KEY_SECRET, "ck|" + wsId + "|" + exp)>`.
 * The key acts as that visitor's chef (read, plan, order, approve), but approves only through an MCP elicitation
 * that shows the exact terms and that the person accepts; never-delegate decisions still need the app.
 */
import { hmac, sameText } from '$lib/server/auth/crypto';
import { judgeKeyExpiry } from './judge-key';
import { isVisitorWorkspace, judgeSecret } from './visitor-id';

type Env = Record<string, string | undefined>;

const KEY_RE = /^ck_(ws-j-[a-z0-9]+)\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** The chef key for a visitor workspace, expiring with the judge keys; null when keys are off. */
export function chefKeyFor(ws: string, env: Env): string | null {
	const secret = judgeSecret(env);
	if (!secret || !isVisitorWorkspace(ws)) return null;
	const exp = Math.floor(judgeKeyExpiry(env).getTime() / 1000);
	return `ck_${ws}.${exp}.${hmac(secret, `ck|${ws}|${exp}`)}`;
}

/** The workspace a chef key acts in, or null. */
export function verifyChefKey(
	key: string | null | undefined,
	env: Env,
	now = new Date()
): string | null {
	const secret = judgeSecret(env);
	const m = key && secret ? KEY_RE.exec(key) : null;
	if (!secret || !m || !isVisitorWorkspace(m[1])) return null;
	const [, ws, exp, mac] = m;
	if (Number(exp) * 1000 <= now.getTime()) return null;
	return sameText(mac, hmac(secret, `ck|${ws}|${exp}`)) ? ws : null;
}

/** The actor label a chef key shows in ops and traces: a short workspace tag, never the key. */
export const chefLabel = (ws: string) => `chef-client-${ws.slice(5, 11)}`;

/** The integrity tag on an elicitation's requestState: the exact approval terms it asked about. */
export function termsState(env: Env, approvalId: string, planVersion: number, termsHash: string) {
	const secret = judgeSecret(env) ?? '';
	const body = `${approvalId}|${planVersion}|${termsHash}`;
	return `${body}|${hmac(secret, `ck-elicit|${body}`)}`;
}

/** Whether an echoed requestState is ours and names exactly these terms. */
export function sameTermsState(
	env: Env,
	state: string | undefined,
	approvalId: string,
	planVersion: number,
	termsHash: string
): boolean {
	return !!state && sameText(state, termsState(env, approvalId, planVersion, termsHash));
}
