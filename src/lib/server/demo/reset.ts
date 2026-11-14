import { SCENARIO } from '$lib/core/scenario';
import { realHandlers } from '$lib/server/tools/handlers';
import { createServerPorts } from '$lib/server/store/server-ports';
import { loadSeedKitchens } from '$lib/server/store/db-ports';
import { SYNTH_WORKSPACE } from '$lib/server/bus/synthetic';
import { STRESS_WORKSPACE } from '$lib/server/bus/stress';
import { currentRun, hasRun, loadCurrentRun, newRunId, setCurrentRun } from './run';

export const DEMO_WORKSPACE = 'ws-demo';

/** The app's ports, built the way the tools build them (so the bus publish hook is in place). */
async function ports() {
	await realHandlers();
	return createServerPorts();
}

const g = globalThis as typeof globalThis & { __mandateRunLoads?: Map<string, Promise<string>> };
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
	if (workspaceId === SYNTH_WORKSPACE || workspaceId === STRESS_WORKSPACE)
		return Promise.resolve(currentRun(workspaceId));
	let p = loads.get(workspaceId);
	if (!p) {
		p = (async () => {
			const { db } = await ports();
			if (!hasRun(workspaceId)) await loadCurrentRun(db, workspaceId);
			if (!hasRun(workspaceId) && opts.start) return (await resetDemoRun(workspaceId)).runId;
			return currentRun(workspaceId);
		})();
		p.catch(() => loads.delete(workspaceId));
		loads.set(workspaceId, p);
		return p;
	}
	return p.then(() => currentRun(workspaceId));
}

/** Workspaces this process has loaded or started (bounded by the visitor cap in `visitor.ts`). */
export function loadedWorkspaces(): number {
	return loads.size;
}

/**
 * Start a fresh run: a new runs row with the seed kitchens, made current. Old runs and their ops stay in
 * the database; everything that reads `currentRun` (store, auth, op stream, /ops) moves to the new one.
 */
export async function resetDemoRun(
	workspaceId: string
): Promise<{ runId: string; previous: string }> {
	const { store, db } = await ports();
	if (!hasRun(workspaceId)) await loadCurrentRun(db, workspaceId);
	const previous = currentRun(workspaceId);
	const runId = newRunId();
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
