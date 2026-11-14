import type { Cookies } from '@sveltejs/kit';
import { hmac, sameText } from './visitor-id';

type Env = Record<string, string | undefined>;

/**
 * Whether key-less presenter actions are open for everyone: always in dev, and on the deployed app only with
 * DEMO_RESET_OPEN=1. Otherwise a presenter signs in once on /ops with the chef or approver key (a session
 * cookie, below), or calls the keyed endpoints (POST /api/demo/reset, /api/agent/run).
 */
export function presenterOpen(env: Env, dev: boolean): boolean {
	return dev || env.DEMO_RESET_OPEN === '1';
}

export const PRESENTER_COOKIE = 'mandate_presenter';
export const PRESENTER_TTL_MS = 12 * 60 * 60 * 1000;

/** The keys that may open a presenter session. */
const ROLE_KEYS = { chef: 'MANDATE_KEY_CHEF', approver: 'MANDATE_KEY_APPROVER' } as const;
type Role = keyof typeof ROLE_KEYS;

const roleKey = (env: Env, role: Role) => {
	const k = env[ROLE_KEYS[role]]?.trim();
	return k && k.length >= 16 ? k : null;
};
const sign = (key: string, role: Role, exp: number) => hmac(key, `presenter:${role}:${exp}`);

/**
 * A presenter session token for a pasted key, or null if the key is neither the chef's nor the approver's.
 * The token is signed with that key, so rotating the key ends every session it opened.
 */
export function presenterToken(pasted: string, env: Env, now = Date.now()): string | null {
	const exp = now + PRESENTER_TTL_MS;
	for (const role of Object.keys(ROLE_KEYS) as Role[]) {
		const key = roleKey(env, role);
		if (key && sameText(key, pasted.trim())) return `${role}.${exp}.${sign(key, role, exp)}`;
	}
	return null;
}

export function validPresenterToken(token: string | undefined, env: Env, now = Date.now()) {
	const [role, expRaw, mac] = (token ?? '').split('.');
	if (!(role in ROLE_KEYS) || !mac) return false;
	const exp = Number(expRaw);
	const key = roleKey(env, role as Role);
	return !!key && Number.isFinite(exp) && exp > now && sameText(mac, sign(key, role as Role, exp));
}

/** Presenter rights for this browser: open for everyone (dev, DEMO_RESET_OPEN) or a signed-in session. */
export function isPresenter(cookies: Cookies, env: Env, dev: boolean): boolean {
	return presenterOpen(env, dev) || validPresenterToken(cookies.get(PRESENTER_COOKIE), env);
}
