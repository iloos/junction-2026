import type { CallContext } from '$lib/core/ports';
import { SCENARIO } from '$lib/core/scenario';
import { clearIdempotency } from './idempotency';
import { realHandlers } from '$lib/server/tools/handlers';
import { createServerPorts } from '$lib/server/store/server-ports';
import { loadSeedKitchens } from '$lib/server/store/db-ports';
import { isMemoryOnly } from '$lib/server/bus';
import { currentRun, hasRun, loadCurrentRun, newRunId, setCurrentRun } from './run';

import { DEMO_WORKSPACE } from './workspaces';
export { DEMO_WORKSPACE };

/** The app's ports, built the way the tools build them (so the bus publish hook is in place). */
async function ports() {
	await realHandlers();
	return createServerPorts();
}

/** Read the workspace's newest run from the database unless this process already knows one. */
async function knowRun(workspaceId: string): Promise<void> {
	if (hasRun(workspaceId)) return;
	const { db } = await ports();
	await loadCurrentRun(db, workspaceId);
}

const g = globalThis as typeof globalThis & {
	__mandateRunLoads?: Map<string, Promise<string>>;
	__mandateRunChecked?: Map<string, number>;
};
const loads = (g.__mandateRunLoads ??= new Map());

/**
 * Make sure this process knows the newest run of a workspace, once per workspace. A sandbox that has no run
 * yet (a new visitor) starts one now, so its scenario clock starts at the visitor's first visit rather than
 * at process start.
 */
export function ensureRunLoaded(
	workspaceId: string,
	opts: { start?: boolean } = {}
): Promise<string> {
	if (isMemoryOnly(workspaceId)) return Promise.resolve(currentRun(workspaceId));
	let p = loads.get(workspaceId);
	if (!p) {
		p = (async () => {
			await knowRun(workspaceId);
			if (!hasRun(workspaceId) && opts.start) {
				const { runId } = await resetDemoRun(workspaceId);
				// A new visitor's sandbox gets the stored real recalls (sandbox.ts imports this module).
				void import('./sandbox').then((m) => m.seedSandboxRecalls(workspaceId, runId));
				return runId;
			}
			return currentRun(workspaceId);
		})();
		p.catch(() => loads.delete(workspaceId));
		loads.set(workspaceId, p);
		checked.set(workspaceId, Date.now());
		return p;
	}
	return p.then(() => refreshRun(workspaceId));
}

/**
 * How often a process re-reads a workspace's newest run. The runs table is the authority: another process (a
 * second instance, staging, a dev server on the same database) may have started a fresh run, and every writer
 * here must follow it within this window instead of writing on to the old one.
 */
const RUN_REFRESH_MS = 5_000;
const checked = (g.__mandateRunChecked ??= new Map<string, number>());

/**
 * Re-read the workspace's newest run now, ignoring the refresh window: a read that missed something another
 * process (or a just-started run) wrote can look again on the current run.
 */
export async function reloadRunNow(workspaceId: string): Promise<string> {
	if (isMemoryOnly(workspaceId)) return currentRun(workspaceId);
	checked.set(workspaceId, Date.now());
	const { db } = await ports();
	return loadCurrentRun(db, workspaceId);
}

async function refreshRun(workspaceId: string): Promise<string> {
	const now = Date.now();
	if (now - (checked.get(workspaceId) ?? 0) >= RUN_REFRESH_MS) {
		checked.set(workspaceId, now);
		const { db } = await ports();
		await loadCurrentRun(db, workspaceId);
	}
	return currentRun(workspaceId);
}

/**
 * Start a fresh run: a new runs row with the seed kitchens, made current. Old runs and their ops stay in
 * the database; everything that reads `currentRun` (store, auth, op stream, /ops) moves to the new one.
 * The workspace's idempotency records are cleared with it (see `clearIdempotency`).
 */
export async function resetDemoRun(
	workspaceId: string
): Promise<{ runId: string; previous: string }> {
	const { store, db } = await ports();
	await knowRun(workspaceId);
	const previous = currentRun(workspaceId);
	const runId = newRunId();
	await clearIdempotency(db, workspaceId);
	await store.ensure({
		workspaceId,
		runId,
		kitchens: loadSeedKitchens(),
		simStart: SCENARIO.start
	});
	setCurrentRun(workspaceId, runId);
	return { runId, previous };
}

/** The stage reset (presenter only): /api/demo/reset and the /ops button in the stage workspace. */
export function resetDemo(): Promise<{ runId: string; previous: string }> {
	return resetDemoRun(DEMO_WORKSPACE);
}

/**
 * A key-derived context on the workspace's current run. A key resolves synchronously (auth reads `currentRun`),
 * so its run can be stale: a sandbox this process hasn't loaded yet (a judge key right after a restart) gets the
 * default run, and a workspace another process has reset still carries the old one. Every call re-reads the
 * run through `ensureRunLoaded` (memoised, refreshed at most every RUN_REFRESH_MS), so reads and writes land on
 * the same run. `MANDATE_RUN` pins the run and is left alone; memory-only workspaces carry their own runs.
 */
export async function onCurrentRun(
	ctx: CallContext,
	pinned: string | undefined = process.env.MANDATE_RUN
): Promise<CallContext> {
	if (pinned || isMemoryOnly(ctx.workspaceId)) return ctx;
	const runId = await ensureRunLoaded(ctx.workspaceId);
	// No runs row (a test or script workspace on an explicit run): its own run is the only one.
	if (!hasRun(ctx.workspaceId)) return ctx;
	return runId === ctx.runId ? ctx : { ...ctx, runId };
}
