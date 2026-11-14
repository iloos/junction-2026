import type { TaskStore } from '$lib/core/ports';
import { createServerPorts } from '$lib/server/store/server-ports';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { handlers, realHandlers } from '$lib/server/tools/handlers';
import { projectedTaskStore } from './project';
import { drizzleTaskStore } from './store';

const g = globalThis as typeof globalThis & { __mandateTasks?: Promise<TaskStore> };

/** The process's TaskStore on the server database (agent_tasks, Aiven or PGlite), reads projected; built once. */
export function serverTasks(): Promise<TaskStore> {
	// The projection reads plans through the scoped handlers, so its calls belong to the caller's workspace.
	g.__mandateTasks ??= Promise.all([createServerPorts(), realHandlers()]).then(([b]) =>
		projectedTaskStore(drizzleTaskStore(b.db as unknown as AnyDb), b.ports, handlers)
	);
	return g.__mandateTasks;
}
