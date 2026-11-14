/**
 * Which run of a workspace is current, and starting a fresh one (R0-d). Tools, the store, the op stream
 * and /ops all follow `currentRun`, so a reset clears the stage without deleting history: old runs stay
 * readable in the `ops` table.
 */
import { desc, eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import type { AnyDb } from '$lib/server/store/drizzle-store';

export const DEFAULT_RUN = 'run-1';

interface RunInfo {
	id: string;
	/** Wall-clock ms when the run started: the scenario clock's anchor. */
	startedAt: number;
}

const g = globalThis as typeof globalThis & { __mandateRuns?: Map<string, RunInfo> };
const runs = (g.__mandateRuns ??= new Map());

/** The current run for a workspace. Synchronous so the store and auth can call it anywhere. */
export function currentRun(workspaceId: string): string {
	return runs.get(workspaceId)?.id ?? DEFAULT_RUN;
}

/** When the current run started (wall ms), for the scenario clock. Before any load: process start. */
export function currentRunStartedAt(workspaceId: string): number {
	return runs.get(workspaceId)?.startedAt ?? PROCESS_START;
}
const PROCESS_START = Date.now();

/** Load the newest run of a workspace from the database (boot, or another instance reset it). */
export async function loadCurrentRun(db: AnyDb, workspaceId: string): Promise<string> {
	const [row] = await db
		.select({ id: schema.runs.id, createdAt: schema.runs.createdAt })
		.from(schema.runs)
		.where(eq(schema.runs.workspaceId, workspaceId))
		.orderBy(desc(schema.runs.createdAt))
		.limit(1);
	if (row) runs.set(workspaceId, { id: row.id, startedAt: new Date(row.createdAt).getTime() });
	return currentRun(workspaceId);
}

/** Make `runId` current (after the store has created it). */
export function setCurrentRun(workspaceId: string, runId: string, startedAt = Date.now()): void {
	runs.set(workspaceId, { id: runId, startedAt });
}

/** A new, sortable run id. */
export function newRunId(now = Date.now()): string {
	return `run-${now.toString(36)}`;
}
