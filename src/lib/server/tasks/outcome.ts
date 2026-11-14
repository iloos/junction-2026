import { err, ok, type Plan, type Result, type ResultMeta } from '$lib/core/contracts';
import type { TaskLedger } from '$lib/core/contracts/task';
import type { CallContext, Ports, ToolHandlers } from '$lib/core/ports';
import { computeLedger, ledgerTotals } from './ledger';

export type GetOutcomeInput = { planId?: string; taskId?: string };
export type GetOutcomeOutput = { ledger: TaskLedger; meta?: ResultMeta };

/**
 * `get_outcome {planId | taskId}`: the ledger for a plan or a task, read through get_plan (so the FulfilmentView is the
 * one every surface reads) plus the workspace's orders, receipts and approvals. Read scope; plans outside the caller's
 * kitchen grant read as not found.
 */
export function createGetOutcome(
	ports: Pick<Ports, 'store' | 'clock' | 'tasks'>,
	handlers: Pick<ToolHandlers, 'get_plan'>
) {
	return async (ctx: CallContext, input: GetOutcomeInput): Promise<Result<GetOutcomeOutput>> => {
		if (!ctx.scopes.includes('read')) return err('FORBIDDEN', 'get_outcome needs the read scope');
		if ((input.planId === undefined) === (input.taskId === undefined))
			return err('INVALID_INPUT', 'give planId or taskId');
		let planIds: string[];
		if (input.taskId) {
			const task = await ports.tasks?.get(ctx.workspaceId, input.taskId);
			if (!task) return err('NOT_FOUND', `task ${input.taskId}`);
			planIds = task.plans.map((p) => p.planId);
		} else planIds = [input.planId!];
		const ledger = await ledgerFor(ctx, ports, handlers, planIds);
		if (!ledger.ok) return ledger;
		return ok({ ledger: ledger.value, meta: { summary: ledgerSummary(ledger.value) } });
	};
}

/** The ledger over the given plans (primary first), each read through the get_plan gate. */
export async function ledgerFor(
	ctx: CallContext,
	ports: Pick<Ports, 'store' | 'clock'>,
	handlers: Pick<ToolHandlers, 'get_plan'>,
	planIds: string[]
): Promise<Result<TaskLedger>> {
	const plans: Plan[] = [];
	for (const planId of planIds) {
		const r = await handlers.get_plan(ctx, { planId });
		if (!r.ok) return r;
		if (ctx.kitchenIds && !ctx.kitchenIds.includes(r.value.plan.kitchenId))
			return err('NOT_FOUND', `plan ${planId}`);
		plans.push(r.value.plan);
	}
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	return ok(
		computeLedger({
			plans,
			orders: Object.values(state.orders),
			receipts: Object.values(state.receipts),
			approvals: Object.values(state.approvals),
			asOf: ports.clock.now().toISOString()
		})
	);
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-IE');

/**
 * One line from the ledger's numbers, D10 words: "ordered" only with a receipt, "supplier confirmed" only for a
 * receipt-backed quantity.
 */
export function ledgerSummary(l: TaskLedger): string {
	const t = ledgerTotals(l);
	const unit = t.units.length === 1 ? ` ${t.units[0]}` : '';
	const parts: string[] = [];
	if (l.needs.length) {
		parts.push(`${fmt(t.required)}${unit} needed`);
		if (t.supplierConfirmed > 0)
			parts.push(`${fmt(t.supplierConfirmed)}${unit} supplier confirmed`);
		if (t.awaitingSupplier > 0) parts.push(`${fmt(t.awaitingSupplier)}${unit} awaiting supplier`);
		if (t.planned > 0) parts.push(`${fmt(t.planned)}${unit} planned, not ordered`);
		if (t.unresolved > 0) parts.push(`${fmt(t.unresolved)}${unit} unresolved`);
	}
	if (l.receiptIds.length)
		parts.push(
			`ordered for €${(l.committedCents / 100).toFixed(2)} (${l.receiptIds.length} receipt${l.receiptIds.length === 1 ? '' : 's'})`
		);
	else parts.push('nothing ordered yet');
	if (l.decisionsLeft) parts.push(`${l.decisionsLeft} decision(s) for a chef`);
	return `${parts.join('; ')}. ${l.nextAction}`.slice(0, 400);
}
