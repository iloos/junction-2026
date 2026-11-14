/**
 * Self-service reset for sandboxes: a visitor's own workspace (`ws-j-…`) or the shared judges' room. Anyone in
 * the sandbox may start it over, at most once per SANDBOX_COOLDOWN_MS per workspace. The stage (ws-demo) is
 * never reset from here; it stays presenter-only.
 */
import { JUDGES_WORKSPACE } from '$lib/server/auth';
import { resetDemoRun } from './reset';
import { isVisitorWorkspace } from './visitor-id';

/** The shared room every visitor can open by link. */
export const SANDBOX_WORKSPACE = JUDGES_WORKSPACE;
export const SANDBOX_COOLDOWN_MS = 20_000;

/** Workspaces the key-less reset may touch. */
export const isSandbox = (ws: string) => ws === SANDBOX_WORKSPACE || isVisitorWorkspace(ws);

const g = globalThis as typeof globalThis & { __mandateSandboxResets?: Map<string, number> };
const last = (g.__mandateSandboxResets ??= new Map());

export type SandboxReset =
	| { ok: true; runId: string; previous: string }
	| { ok: false; retryInMs: number }
	| { ok: false; forbidden: true };

/** Start a sandbox over: a fresh run, the old one kept for audit. */
export async function resetSandbox(
	workspaceId: string = SANDBOX_WORKSPACE,
	now = Date.now()
): Promise<SandboxReset> {
	if (!isSandbox(workspaceId)) return { ok: false, forbidden: true };
	const wait = (last.get(workspaceId) ?? 0) + SANDBOX_COOLDOWN_MS - now;
	if (wait > 0) return { ok: false, retryInMs: wait };
	last.set(workspaceId, now);
	// Entries older than the cooldown carry no information; drop them so the map stays small.
	if (last.size > 500)
		for (const [ws, t] of last) if (now - t > SANDBOX_COOLDOWN_MS) last.delete(ws);
	const r = await resetDemoRun(workspaceId);
	return { ok: true, ...r };
}
