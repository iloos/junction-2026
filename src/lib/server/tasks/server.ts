import type { TaskStore } from '$lib/core/ports';
import { createServerPorts } from '$lib/server/store/server-ports';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { drizzleTaskStore } from './store';

const g = globalThis as typeof globalThis & { __mandateTasks?: Promise<TaskStore> };

/** The process's TaskStore on the server database (agent_tasks, Aiven or PGlite), built once. */
export function serverTasks(): Promise<TaskStore> {
	g.__mandateTasks ??= createServerPorts().then((b) => drizzleTaskStore(b.db as unknown as AnyDb));
	return g.__mandateTasks;
}
