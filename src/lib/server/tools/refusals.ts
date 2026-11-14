/**
 * Refused agent calls in the op log (RecordRefusal): when the gate answers an outside or kitchen agent with
 * FORBIDDEN, that refusal is written as an op, so Operations shows it as it happens ("an outside agent tried to
 * approve; refused"). Chef and UI calls are not recorded: their errors are input mistakes, not trust events.
 * At most one per (workspace, caller, tool, plan) per REFUSAL_WINDOW_MS, so a looping key can't flood the log.
 */
import type { DomainError, PendingOp } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';

export const REFUSAL_WINDOW_MS = 60_000;
const RECORDED_CALLERS = new Set(['external_agent', 'kitchen_agent']);

const g = globalThis as typeof globalThis & { __mandateRefusals?: Map<string, number> };
const lastWritten = (g.__mandateRefusals ??= new Map());

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/**
 * Whether this refusal is one the op log keeps as a RecordRefusal. A commit the caller may make but the rules
 * stopped (an approval missing) is already in the log as a failed CommitOrder, so it isn't recorded twice; a
 * caller without the order scope never reaches that handler and is recorded here.
 */
export function isRecordedRefusal(ctx: CallContext, error: DomainError, tool?: string): boolean {
	if (error.code !== 'FORBIDDEN' || !RECORDED_CALLERS.has(ctx.actor.kind)) return false;
	if (tool === 'commit_order' && ctx.scopes.includes('order')) return false;
	return true;
}

/**
 * Write the refusal unless the same caller was refused the same tool on the same plan within the window.
 * Never throws: a failed write is logged and the caller still gets its 403.
 */
export async function recordRefusal(
	ctx: CallContext,
	tool: string,
	input: unknown,
	error: DomainError,
	now = Date.now()
): Promise<boolean> {
	if (!isRecordedRefusal(ctx, error, tool)) return false;
	const i = (input ?? {}) as Record<string, unknown>;
	const target = str(i.planId) ?? str(i.approvalId) ?? '';
	const key = [ctx.workspaceId, ctx.runId, ctx.actor.kind, ctx.actor.id, tool, target].join('|');
	const last = lastWritten.get(key);
	if (last !== undefined && now - last < REFUSAL_WINDOW_MS) return false;
	lastWritten.set(key, now);
	if (lastWritten.size > 5000)
		for (const k of [...lastWritten.keys()].slice(0, 1000)) lastWritten.delete(k);

	try {
		const { createServerPorts } = await import('$lib/server/store/server-ports');
		const { store } = await createServerPorts();
		const r = await store.transact(ctx.workspaceId, async (_tx, state) => {
			// The plan it was aimed at: named in the input, or through the approval it tried to decide.
			const approvalId = str(i.approvalId);
			const planId =
				str(i.planId) ?? (approvalId ? state.approvals[approvalId]?.planId : undefined);
			const kitchenId = str(i.kitchenId) ?? (planId ? state.plans[planId]?.kitchenId : undefined);
			const op: PendingOp = {
				workspaceId: ctx.workspaceId,
				runId: ctx.runId,
				actor: ctx.actor,
				via: ctx.via,
				op: {
					type: 'RecordRefusal',
					tool,
					code: error.code,
					...(error.sub ? { sub: error.sub } : {}),
					message: error.message.slice(0, 300),
					...(planId ? { planId } : {}),
					...(kitchenId ? { kitchenId } : {})
				}
			};
			return { ops: [op], value: null };
		});
		if (!r.ok) throw new Error(r.error.message);
		return true;
	} catch (e) {
		lastWritten.delete(key);
		console.warn(`[tools] recording a refused ${tool} failed: ${(e as Error)?.message ?? e}`);
		return false;
	}
}
