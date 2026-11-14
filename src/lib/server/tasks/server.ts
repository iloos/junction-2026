import type { TaskStore } from '$lib/core/ports';
import { createServerPorts } from '$lib/server/store/server-ports';
import type { AnyDb } from '$lib/server/store/drizzle-store';
import { realHandlers } from '$lib/server/tools/handlers';
import { projectedTaskStore } from './project';
import { drizzleTaskStore } from './store';

const g = globalThis as typeof globalThis & { __mandateTasks?: Promise<TaskStore> };

/** The process's TaskStore on the server database (agent_tasks, Aiven or PGlite), reads projected; built once. */
export function serverTasks(): Promise<TaskStore> {
	g.__mandateTasks ??= Promise.all([createServerPorts(), realHandlers()]).then(([b, h]) =>
		projectedTaskStore(drizzleTaskStore(b.db as unknown as AnyDb), b.ports, h)
	);
	return g.__mandateTasks;
}
