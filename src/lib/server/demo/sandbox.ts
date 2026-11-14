/**
 * Self-service reset for the judges' sandbox: anyone may start ws-judges over, at most once per
 * SANDBOX_COOLDOWN_MS. The stage workspace (ws-demo) is never reset from here; it stays presenter-only.
 */
import { JUDGES_WORKSPACE } from '$lib/server/auth';
import { resetDemoRun } from './reset';

export const SANDBOX_WORKSPACE = JUDGES_WORKSPACE;
export const SANDBOX_COOLDOWN_MS = 20_000;

const g = globalThis as typeof globalThis & { __mandateSandboxReset?: number };

export type SandboxReset =
	{ ok: true; runId: string; previous: string } | { ok: false; retryInMs: number };

/** Start the judges' sandbox over: a fresh run, the old one kept for audit. */
export async function resetSandbox(now = Date.now()): Promise<SandboxReset> {
	const wait = (g.__mandateSandboxReset ?? 0) + SANDBOX_COOLDOWN_MS - now;
	if (wait > 0) return { ok: false, retryInMs: wait };
	g.__mandateSandboxReset = now;
	const r = await resetDemoRun(SANDBOX_WORKSPACE);
	return { ok: true, ...r };
}
