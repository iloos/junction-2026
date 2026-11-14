/** Opening a paired sandbox on this device: its signed visitor cookie, and the room set to the sandbox (not the stage). */
import type { Cookies } from '@sveltejs/kit';
import { ROOM_COOKIE, VISITOR_COOKIE } from '$lib/server/demo/visitor';
import { signVisitor } from '$lib/server/demo/visitor-id';

const COOKIE_AGE_S = 60 * 60 * 24 * 14;
const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: COOKIE_AGE_S };

export function openSandbox(
	cookies: Cookies,
	workspaceId: string,
	env: Record<string, string | undefined>
) {
	cookies.set(VISITOR_COOKIE, signVisitor(workspaceId, env), opts);
	cookies.set(ROOM_COOKIE, 'own', opts);
}
