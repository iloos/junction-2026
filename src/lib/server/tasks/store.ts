import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { err, ok, type Result } from '$lib/core/contracts';
import { Task } from '$lib/core/contracts/task';
import type { TaskStore } from '$lib/core/ports';
import { agentTasks } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';

/**
 * TaskStore adapters. Both compare-and-set on `version`: `put(task, expected)` writes only when the stored version is
 * `expected` (null = the task must not exist yet) and stores it at `expected + 1` (0 for a new task), so two turns on
 * one task can't both win. A lost race is STALE_VERSION; the caller re-reads and retries.
 */

const CLOSED = ['done', 'cancelled', 'failed'];

function stale(id: string, expected: number | null, have: number | null) {
	return err(
		'STALE_VERSION',
		`task ${id} is at ${have === null ? 'nothing' : `v${have}`}, not ${expected === null ? 'new' : `v${expected}`}`
	);
}

export function memoryTaskStore(): TaskStore {
	const rows = new Map<string, Task>();
	const key = (ws: string, id: string) => `${ws}\u0000${id}`;
	return {
		async get(ws, id) {
			const t = rows.get(key(ws, id));
			return t ? structuredClone(t) : null;
		},
		async list(ws, o = {}) {
			return [...rows.values()]
				.filter(
					(t) =>
						t.workspaceId === ws &&
						(!o.kitchenId || t.kitchenId === o.kitchenId) &&
						(o.open === undefined || o.open !== CLOSED.includes(t.state))
				)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
				.slice(0, o.limit ?? 50)
				.map((t) => structuredClone(t));
		},
		async put(task, expected): Promise<Result<Task>> {
			const k = key(task.workspaceId, task.id);
			const have = rows.get(k)?.version ?? null;
			if (have !== expected) return stale(task.id, expected, have);
			const next = Task.parse({ ...task, version: expected === null ? 0 : expected + 1 });
			rows.set(k, next);
			return ok(structuredClone(next));
		}
	};
}

export function drizzleTaskStore(db: AnyDb): TaskStore {
	const at = (ws: string, id: string) => and(eq(agentTasks.workspaceId, ws), eq(agentTasks.id, id));
	return {
		async get(ws, id) {
			const [r] = await db.select().from(agentTasks).where(at(ws, id));
			return r ? Task.parse(r.doc) : null;
		},
		async list(ws, o = {}) {
			const conds = [eq(agentTasks.workspaceId, ws)];
			if (o.kitchenId) conds.push(eq(agentTasks.kitchenId, o.kitchenId));
			if (o.open === true) conds.push(notInArray(agentTasks.state, CLOSED));
			if (o.open === false) conds.push(inArray(agentTasks.state, CLOSED));
			const rs = await db
				.select()
				.from(agentTasks)
				.where(and(...conds))
				.orderBy(desc(agentTasks.updatedAt))
				.limit(o.limit ?? 50);
			return rs.map((r: { doc: unknown }) => Task.parse(r.doc));
		},
		async put(task, expected): Promise<Result<Task>> {
			const next = Task.parse({ ...task, version: expected === null ? 0 : expected + 1 });
			const values = {
				workspaceId: next.workspaceId,
				id: next.id,
				kitchenId: next.kitchenId,
				state: next.state,
				version: next.version,
				doc: next,
				updatedAt: next.updatedAt
			};
			if (expected === null) {
				const inserted = await db
					.insert(agentTasks)
					.values(values)
					.onConflictDoNothing()
					.returning({ v: agentTasks.version });
				if (inserted.length) return ok(next);
			} else {
				const updated = await db
					.update(agentTasks)
					.set(values)
					.where(and(at(next.workspaceId, next.id), eq(agentTasks.version, expected)))
					.returning({ v: agentTasks.version });
				if (updated.length) return ok(next);
			}
			const [r] = await db
				.select({ v: agentTasks.version })
				.from(agentTasks)
				.where(at(next.workspaceId, next.id));
			return stale(next.id, expected, r?.v ?? null);
		}
	};
}
