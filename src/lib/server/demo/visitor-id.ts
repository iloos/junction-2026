/**
 * Visitor identity primitives (D9). A visitor workspace is `ws-j-` + 24 lowercase hex chars (96 random bits),
 * and it reaches the server only inside a signed value: the id alone is never authorisation.
 */
import { randomBytes } from 'node:crypto';
import { hmac, sameText } from '$lib/server/auth/crypto';
import { VisitorWorkspaceId } from '$lib/core/contracts';

type Env = Record<string, string | undefined>;

export const isVisitorWorkspace = (ws: string | null | undefined): ws is string =>
	!!ws && VisitorWorkspaceId.safeParse(ws).success;

export function newVisitorWorkspace(): string {
	return 'ws-j-' + randomBytes(12).toString('hex');
}

/** Shorter secrets are treated as unset, so an env typo can't open the door. */
const MIN_SECRET = 16;

/** JUDGE_KEY_SECRET, or null when it is unset or too short. */
export function judgeSecret(env: Env): string | null {
	const s = env.JUDGE_KEY_SECRET?.trim();
	return s && s.length >= MIN_SECRET ? s : null;
}

const g = globalThis as typeof globalThis & { __mandateCookieSecret?: string };
let warned = false;

/**
 * The visitor cookie's signing secret: JUDGE_KEY_SECRET, or a random one for this process (dev, or a deploy
 * without the secret: visitors then get a fresh sandbox after every restart, never someone else's).
 */
function cookieSecret(env: Env): string {
	const s = judgeSecret(env);
	if (s) return s;
	if (!warned && process.env.NODE_ENV === 'production') {
		warned = true;
		console.warn('[visitor] JUDGE_KEY_SECRET unset: visitor cookies are signed per process');
	}
	return (g.__mandateCookieSecret ??= randomBytes(32).toString('hex'));
}

/** Cookie value for a visitor workspace: `<ws>.<HMAC("vs|" + ws)>`. */
export function signVisitor(ws: string, env: Env): string {
	return `${ws}.${hmac(cookieSecret(env), `vs|${ws}`)}`;
}

/** The visitor workspace a cookie value proves, or null if it's missing, malformed or forged. */
export function readVisitor(value: string | undefined, env: Env): string | null {
	if (!value) return null;
	const dot = value.indexOf('.');
	const ws = value.slice(0, dot);
	if (dot < 0 || !isVisitorWorkspace(ws)) return null;
	return sameText(value.slice(dot + 1), hmac(cookieSecret(env), `vs|${ws}`)) ? ws : null;
}
