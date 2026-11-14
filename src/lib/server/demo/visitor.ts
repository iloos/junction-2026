/**
 * Which workspace a browser acts in (D9): the one resolver behind the kitchen, /request, /ops, the op stream
 * and the sandbox reset.
 *
 * - Every visitor gets their own sandbox, `ws-j-<id>`, from a signed cookie (`mandate_visitor`), seeded lazily
 *   with the seed kitchens and a fresh run on first use. Only that browser reaches it: another visitor's id in
 *   a link, a cookie or a query never selects it.
 * - A link can move the browser between rooms (cookie `mandate_room`): `?ws=ws-judges` (the shared room),
 *   `?ws=mine` (back to your own sandbox), and `?ws=ws-demo` (the stage) for presenters only. Any other value,
 *   including a visitor id, is ignored.
 * - Presenters (dev, DEMO_RESET_OPEN=1, or signed in on /ops) default to the stage.
 * - At most MAX_VISITORS sandboxes are seeded per process; past that, new visitors share ws-judges.
 */
import type { Cookies } from '@sveltejs/kit';
import { JUDGES_WORKSPACE } from '$lib/server/auth';
import { isPresenter } from './presenter';
import { ensureRunLoaded, DEMO_WORKSPACE } from './reset';
import { newVisitorWorkspace, readVisitor, signVisitor } from './visitor-id';

type Env = Record<string, string | undefined>;

export const VISITOR_COOKIE = 'mandate_visitor';
export const ROOM_COOKIE = 'mandate_room';
export const MAX_VISITORS = 300;
const COOKIE_AGE_S = 60 * 60 * 24 * 14;

/** own: this browser's sandbox · shared: ws-judges · stage: ws-demo · full: cap reached, sharing ws-judges. */
export type RoomKind = 'own' | 'shared' | 'stage' | 'full';

export interface Visitor {
	workspaceId: string;
	/** This browser's own sandbox id (whether or not it's the current room). */
	own: string;
	kind: RoomKind;
	presenter: boolean;
}

const g = globalThis as typeof globalThis & { __mandateVisitors?: Set<string> };
const seeded = (g.__mandateVisitors ??= new Set());

const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: COOKIE_AGE_S };

type Room = 'own' | typeof JUDGES_WORKSPACE | typeof DEMO_WORKSPACE;

/** A room a link or the room cookie may select, or null. */
function roomFrom(value: string | null | undefined, presenter: boolean): Room | null {
	if (value === 'mine' || value === 'own') return 'own';
	if (value === JUDGES_WORKSPACE) return value;
	if (value === DEMO_WORKSPACE && presenter) return value;
	return null;
}

/** This browser's own sandbox from its signed cookie, without minting one (for read-only checks). */
export function ownWorkspace(cookies: Cookies, env: Env): string | null {
	return readVisitor(cookies.get(VISITOR_COOKIE), env);
}

/**
 * Resolve (and, on a page load with `?ws=`, change) this browser's workspace, then make sure that workspace has
 * a current run. `follow`: honour `?ws=` on the URL; page loads pass it, API calls
 * don't, so a stray query can't move a running screen.
 */
export async function visitorWorkspace(
	event: { cookies: Cookies; url?: URL },
	env: Env,
	dev: boolean,
	opts: { follow?: boolean } = {}
): Promise<Visitor> {
	const { cookies, url } = event;
	const presenter = isPresenter(cookies, env, dev);

	let own = ownWorkspace(cookies, env);
	if (!own) {
		own = newVisitorWorkspace();
		cookies.set(VISITOR_COOKIE, signVisitor(own, env), cookieOpts);
	}

	if (opts.follow && url) {
		const asked = roomFrom(url.searchParams.get('ws'), presenter);
		if (asked) cookies.set(ROOM_COOKIE, asked, cookieOpts);
	}
	const room = roomFrom(cookies.get(ROOM_COOKIE), presenter);
	const chosen = room === 'own' ? own : (room ?? (presenter ? DEMO_WORKSPACE : own));

	let workspaceId = chosen;
	let kind: RoomKind =
		chosen === DEMO_WORKSPACE ? 'stage' : chosen === JUDGES_WORKSPACE ? 'shared' : 'own';
	if (kind === 'own' && !seeded.has(chosen)) {
		if (seeded.size >= MAX_VISITORS) {
			workspaceId = JUDGES_WORKSPACE;
			kind = 'full';
		} else seeded.add(chosen);
	}

	await ensureRunLoaded(workspaceId, { start: kind !== 'stage' });
	return { workspaceId, own, kind, presenter };
}

/** Plain words for the room, for page headers. */
export function roomLabel(v: Pick<Visitor, 'kind'>): string {
	return {
		own: 'Your sandbox',
		shared: "Judges' shared room",
		stage: 'Stage run',
		full: "Judges' shared room (sandboxes are full)"
	}[v.kind];
}
