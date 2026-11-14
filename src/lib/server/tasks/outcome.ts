import {
	err,
	ok,
	type Approval,
	type Plan,
	type Result,
	type ResultMeta
} from '$lib/core/contracts';
import type { TaskLedger } from '$lib/core/contracts/task';
import type { CallContext, Ports, ToolHandlers } from '$lib/core/ports';
import { computeLedger } from './ledger';

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
	const r = await readTask(ctx, ports, handlers, planIds);
	return r.ok ? ok(r.value.ledger) : r;
}

/** The task's plans as get_plan returns them, the workspace's approvals for them, and the ledger over both. */
export async function readTask(
	ctx: CallContext,
	ports: Pick<Ports, 'store' | 'clock'>,
	handlers: Pick<ToolHandlers, 'get_plan'>,
	planIds: string[]
): Promise<Result<{ ledger: TaskLedger; plans: Plan[]; approvals: Approval[] }>> {
	const plans: Plan[] = [];
	for (const planId of planIds) {
		const r = await handlers.get_plan(ctx, { planId });
		if (!r.ok) return r;
		if (ctx.kitchenIds && !ctx.kitchenIds.includes(r.value.plan.kitchenId))
			return err('NOT_FOUND', `plan ${planId}`);
		plans.push(r.value.plan);
	}
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	const ids = new Set(planIds);
	const approvals = Object.values(state.approvals).filter((a) => ids.has(a.planId));
	return ok({
		plans,
		approvals,
		ledger: computeLedger({
			plans,
			orders: Object.values(state.orders),
			receipts: Object.values(state.receipts),
			approvals,
			asOf: ports.clock.now().toISOString()
		})
	});
}

/** "Wed 9 Dec" for a delivery date. */
export const dayWords = (iso: string) =>
	new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-IE');

/**
 * One line from the ledger's numbers, D10 words: "ordered" only with a receipt (never as a negation either), "supplier confirmed" only for a
 * receipt-backed quantity.
 */
export function ledgerSummary(l: TaskLedger, o: { deliverBy?: string } = {}): string {
	const parts: string[] = [];
	// Quantities add up per unit only: "4 kg + 2 l needed", never "6 needed".
	const units = [...new Set(l.needs.map((n) => n.required.unit))];
	const per = (
		k: 'required' | 'supplierConfirmed' | 'awaitingSupplier' | 'planned' | 'unresolved'
	) =>
		units
			.map((u) => {
				const v = l.needs
					.filter((n) => n.required.unit === u)
					.reduce(
						(s, n) =>
							s + (k === 'planned' ? n.plannedKnown.value + n.plannedUnknown.value : n[k].value),
						0
					);
				return v > 0 ? `${fmt(v)} ${u}` : '';
			})
			.filter(Boolean)
			.join(' + ');
	if (l.needs.length) {
		parts.push(`${per('required') || '0'} needed`);
		const add = (k: Parameters<typeof per>[0], words: string) => {
			const v = per(k);
			if (v) parts.push(`${v} ${words}`);
		};
		add('supplierConfirmed', 'supplier confirmed');
		add('awaitingSupplier', 'awaiting supplier');
		add('planned', 'planned, not yet submitted');
		add('unresolved', 'unresolved');
	}
	if (l.receiptIds.length)
		parts.push(
			`ordered for €${(l.committedCents / 100).toFixed(2)} (${l.receiptIds.length} receipt${l.receiptIds.length === 1 ? '' : 's'})`
		);
	else parts.push('no order placed yet');
	if (l.decisionsLeft)
		parts.push(
			`${l.decisionsLeft} ${l.decisionsLeft === 1 ? 'decision waits' : 'decisions wait'} for you`
		);
	const day = o.deliverBy ? `For ${dayWords(o.deliverBy)}: ` : '';
	const text = `${day}${parts.join('; ')}.`;
	// The next action only when it adds something the parts don't already say.
	return (l.decisionsLeft ? text : `${text} ${l.nextAction}`).slice(0, 400);
}
