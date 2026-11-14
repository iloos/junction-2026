import { SCENARIO } from '$lib/core/scenario';
import { realHandlers } from '$lib/server/tools/handlers';
import { createServerPorts } from '$lib/server/store/server-ports';
import { loadSeedKitchens } from '$lib/server/store/db-ports';
import { SYNTH_WORKSPACE } from '$lib/server/bus/synthetic';
import { currentRun, newRunId, setCurrentRun } from './run';

export const DEMO_WORKSPACE = 'ws-demo';

/** The app's ports, built the way the tools build them (so the bus publish hook is in place). */
async function ports() {
	await realHandlers();
	return createServerPorts();
}

/** Make sure this process knows the newest run of a workspace (server ports load it when they build). */
export async function ensureRunLoaded(workspaceId: string): Promise<string> {
	if (workspaceId === SYNTH_WORKSPACE) return currentRun(workspaceId);
	await ports();
	return currentRun(workspaceId);
}

/**
 * Start a fresh run: a new runs row with the seed kitchens, made current. Old runs and their ops stay in
 * the database; everything that reads `currentRun` (store, auth, op stream, /ops) moves to the new one.
 */
export async function resetDemoRun(
	workspaceId: string
): Promise<{ runId: string; previous: string }> {
	const previous = await ensureRunLoaded(workspaceId);
	const { store } = await ports();
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

/** The demo reset every surface calls: /api/demo/reset, the /ops button and the kitchen's endpoint. */
export function resetDemo(): Promise<{ runId: string; previous: string }> {
	return resetDemoRun(DEMO_WORKSPACE);
}
