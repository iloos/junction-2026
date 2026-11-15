/**
 * Self-service reset for sandboxes: a visitor's own workspace (`ws-j-…`) or the shared judges' room, at most once
 * per SANDBOX_COOLDOWN_MS per workspace. A visitor starts their own sandbox over; a room others share is started
 * over by the presenter only, so one click never wipes everyone's stores. The stage (ws-demo) is never reset from
 * here; it stays presenter-only.
 */
import { JUDGES_WORKSPACE } from './workspaces';
import { resetDemoRun } from './reset';
import { isVisitorWorkspace } from './visitor-id';
import { errMsg, log } from '$lib/server/obs/log';

/** The shared room every visitor can open by link. */
export const SANDBOX_WORKSPACE = JUDGES_WORKSPACE;
export const SANDBOX_COOLDOWN_MS = 20_000;

/** Workspaces the key-less reset may touch. */
export const isSandbox = (ws: string) => ws === SANDBOX_WORKSPACE || isVisitorWorkspace(ws);

const g = globalThis as typeof globalThis & { __mandateSandboxResets?: Map<string, number> };
const last = (g.__mandateSandboxResets ??= new Map());

type SandboxReset =
	| { ok: true; runId: string; previous: string }
	| { ok: false; retryInMs: number }
	| { ok: false; forbidden: true };

/** A room others share (anything but a visitor's own sandbox): starting it over needs the presenter. */
export const isSharedRoom = (ws: string) => !isVisitorWorkspace(ws);

/** Start a sandbox over: a fresh run, the old one kept for audit. A shared room needs `presenter`. */
export async function resetSandbox(
	workspaceId: string,
	now = Date.now(),
	opts: { presenter?: boolean } = {}
): Promise<SandboxReset> {
	if (!isSandbox(workspaceId)) return { ok: false, forbidden: true };
	if (isSharedRoom(workspaceId) && !opts.presenter) return { ok: false, forbidden: true };
	const wait = (last.get(workspaceId) ?? 0) + SANDBOX_COOLDOWN_MS - now;
	if (wait > 0) return { ok: false, retryInMs: wait };
	last.set(workspaceId, now);
	// Entries older than the cooldown carry no information; drop them so the map stays small.
	if (last.size > 500)
		for (const [ws, t] of last) if (now - t > SANDBOX_COOLDOWN_MS) last.delete(ws);
	const r = await resetDemoRun(workspaceId);
	void seedSandboxRecalls(workspaceId, r.runId);
	return { ok: true, ...r };
}

/**
 * A new sandbox run gets the real recalls the monitor already read (stored notices, no network call), so a
 * visitor's own workspace shows them too. Runs in the background; a failure leaves the run without them.
 */
export async function seedSandboxRecalls(workspaceId: string, runId: string): Promise<void> {
	try {
		const { prepareSandboxRecalls } = await import('$lib/server/web/sandbox');
		await prepareSandboxRecalls(process.env, {
			workspaceId,
			runId,
			actor: { kind: 'system', id: 'web:sandbox' },
			scopes: [],
			via: 'web:sandbox'
		});
	} catch (e) {
		log.warn('sandbox.recalls_not_applied', { error: errMsg(e) });
	}
}
