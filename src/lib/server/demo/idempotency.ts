import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import type { AnyDb } from '$lib/server/store/drizzle-store';

/**
 * Forget a workspace's idempotency records when its run resets. They are keyed per workspace, not per run, so a
 * key retried after a reset would otherwise replay a plan from the old run that the new run can't find.
 */
export async function clearIdempotency(db: AnyDb, workspaceId: string): Promise<void> {
	await db.delete(schema.idempotency).where(eq(schema.idempotency.workspaceId, workspaceId));
}
