/**
 * Order flow (PRODUCT ★1 ★4 ★5 ★6 ★7): place → quote + tier → approval → commit, through one transaction per call.
 * Rules (ARCHITECTURE "Rules the handlers enforce"): idempotency per (workspace, caller, tool, key) + request hash;
 * caps gate the act tier only; budget week = ISO week of deliverBy; any held quote opens a new pending approval;
 * a commit re-quotes and fails TERMS_CHANGED when terms moved; Terminal lines commit as awaiting supplier.
 */
import {
	err,
	ok,
	type Approval,
	type DomainError,
	type Kitchen,
	type Offer,
	type Order,
	type PendingOp,
	type Plan,
	type Product,
	type Receipt,
	type Result,
	type ToolInput,
	type ToolOutput
} from '../contracts';
import { requestHash, sha256Hex, termsHash } from '../hash';
import {
	draftFromLine,
	isoWeek,
	orderedBefore,
	recalledProducts,
	tierLines,
	type DraftLine,
	type TierResult
} from '../mandate/tier';
import type { CallContext, Ports, Tx } from '../ports';
import type { WorkspaceState } from '../state';

const APPROVAL_TTL_MS = 24 * 3600 * 1000;

const short = async (s: string) => (await sha256Hex(s)).slice(0, 12);

function pending(ctx: CallContext, op: PendingOp['op'], idempotencyKey?: string): PendingOp {
	return {
		workspaceId: ctx.workspaceId,
		runId: ctx.runId,
		actor: ctx.actor,
		via: ctx.via,
		idempotencyKey,
		op
	};
}

async function kitchenOf(ports: Ports, ctx: CallContext, id: string): Promise<Kitchen | null> {
	return (await ports.store.kitchens(ctx.workspaceId)).find((k) => k.id === id) ?? null;
}

/** Rounds a requested quantity up to the product's lot step (D6: allowedLotSize is a hard minimum and step). */
export function toLot(qty: number, unit: string, p: Product): DraftLine['qty'] {
	const step = p.lotStep;
	if (step <= 0.01) return { value: qty, unit };
	const lots = Math.max(1, Math.ceil(qty / step - 1e-9));
	const value = +(lots * step).toFixed(3);
	return value === qty
		? { value, unit }
		: {
				value,
				unit,
				rounding: `${qty} ${unit} → ${lots} × ${step} ${unit} lot = ${value} ${unit}`
			};
}

/** Builds the RecordOffer (+ pending approval) ops for a tiered plan; returns the plan as it will be after them. */
export async function quoteOps(
	ctx: CallContext,
	ports: Ports,
	plan: Plan,
	kitchen: Kitchen,
	t: TierResult,
	offers: Offer[]
): Promise<{ ops: PendingOp[]; plan: Plan; approvalId: string | null }> {
	const hash = await termsHash({ deliverBy: plan.deliverBy, lines: t.termsLines });
	const version = plan.version + 1;
	const ops: PendingOp[] = [
		pending(ctx, {
			type: 'RecordOffer',
			planId: plan.id,
			baseVersion: plan.version,
			offers,
			lines: t.lines,
			planState: t.planState,
			totalCents: t.totalCents,
			termsHash: hash
		})
	];
	let approvalId: string | null = null;
	if (t.held) {
		approvalId = `ap-${plan.id}-v${version}`;
		const approval: Approval = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: approvalId,
			planId: plan.id,
			planVersion: version,
			termsHash: hash,
			mandateVersion: kitchen.mandate.version,
			lineIds: t.held.lineIds,
			tier: t.held.tier,
			state: 'pending',
			requestedBy: ctx.actor,
			expiresAt: new Date(ports.clock.now().getTime() + APPROVAL_TTL_MS).toISOString()
		};
		ops.push(pending(ctx, { type: 'RecordApproval', approval }));
	}
	return {
		ops,
		plan: {
			...plan,
			lines: t.lines,
			state: t.planState,
			totalCents: t.totalCents,
			termsHash: hash,
			version
		},
		approvalId
	};
}

/** Runs `fn` inside a transaction with idempotency: replays the stored response, refuses a changed payload. */
async function idempotent<T>(
	ports: Ports,
	ctx: CallContext,
	tool: string,
	key: string,
	payload: unknown,
	fn: (
		tx: Tx,
		state: WorkspaceState
	) => Promise<{ ops: PendingOp[]; value: Result<T> } | { error: DomainError }>
): Promise<Result<T>> {
	const hash = await requestHash({ tool, payload });
	const k = { workspaceId: ctx.workspaceId, caller: ctx.actor.id, tool, key };
	const r = await ports.store.transact(ctx.workspaceId, async (tx, state) => {
		const seen = await ports.store.idempotency(tx, { ...k, requestHash: hash });
		if (seen.status === 'conflict')
			return { error: err('DUPLICATE', `key ${key} was used with a different payload`).error };
		if (seen.status === 'replay') return { ops: [], value: seen.response as Result<T> };
		const out = await fn(tx, state);
		if ('error' in out) return out;
		await ports.store.rememberResponse(tx, k, out.value);
		return out;
	});
	return r.ok ? r.value.value : r;
}

export async function placeOrder(
	ports: Ports,
	ctx: CallContext,
	input: ToolInput<'place_order'>
): Promise<Result<ToolOutput<'place_order'>>> {
	const ids = [...new Set(input.lines.map((l) => l.productId))];
	const products = await ports.catalog.get(ids);
	const notFound = ids.filter((id) => !products.has(id));
	if (notFound.length)
		return err('NOT_FOUND', `unknown product ids: ${notFound.join(', ')}`, {
			detail: { notFound }
		});
	const kitchen = await kitchenOf(ports, ctx, input.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${input.kitchenId}`);
	const { offers } = await ports.catalog.offers(ids, input.deliverBy); // outside the lock (D6)
	const planId = `pl-${ctx.runId}-${await short(`${ctx.actor.id}|${input.idempotencyKey}`)}`;

	return idempotent(ports, ctx, 'place_order', input.idempotencyKey, input, async (tx, state) => {
		const spent = await ports.store.lockBudget(tx, {
			workspaceId: ctx.workspaceId,
			kitchenId: kitchen.id,
			week: isoWeek(input.deliverBy)
		});
		const drafts: DraftLine[] = input.lines.map((l, i) => ({
			id: `${planId}-l${i + 1}`,
			productId: l.productId,
			qty: toLot(l.qty, l.unit, products.get(l.productId)!),
			provenance: { source: 'user', note: `${ctx.actor.kind} via ${ctx.via}` }
		}));
		const t = tierLines({
			kitchen,
			lines: drafts,
			offers: new Map(offers.map((o) => [o.productId, o])),
			products,
			weekSpentCents: spent,
			actor: ctx.actor.kind,
			createdBy: ctx.actor.kind,
			orderedBefore: orderedBefore(state, kitchen),
			recalled: recalledProducts(state)
		});
		const plan0: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: planId,
			kitchenId: kitchen.id,
			version: 0,
			state: 'draft',
			deliverBy: input.deliverBy,
			needs: [],
			lines: [],
			totalCents: null,
			termsHash: null,
			createdBy: ctx.actor,
			idempotencyKey: input.idempotencyKey
		};
		const q = await quoteOps(ctx, ports, plan0, kitchen, t, offers);
		return {
			ops: [pending(ctx, { type: 'CreatePlan', plan: plan0 }, input.idempotencyKey), ...q.ops],
			value: ok({ plan: q.plan, approvalId: q.approvalId })
		};
	});
}

/** The newest pending or granted approval for a plan. */
export function currentApproval(state: WorkspaceState, planId: string): Approval | null {
	return (
		Object.values(state.approvals)
			.filter((a) => a.planId === planId && (a.state === 'pending' || a.state === 'granted'))
			.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null
	);
}

export async function getPlan(
	ports: Ports,
	ctx: CallContext,
	input: ToolInput<'get_plan'>
): Promise<Result<ToolOutput<'get_plan'>>> {
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	const plan = state.plans[input.planId];
	if (!plan) return err('NOT_FOUND', `plan ${input.planId}`);
	const a = currentApproval(state, plan.id);
	return ok({
		plan,
		approval: a
			? {
					id: a.id,
					state: a.state,
					planVersion: a.planVersion,
					termsHash: a.termsHash,
					lineIds: a.lineIds,
					tier: a.tier,
					mandateVersion: a.mandateVersion,
					expiresAt: a.expiresAt,
					requestedBy: a.requestedBy,
					...(a.decidedBy ? { decidedBy: a.decidedBy } : {})
				}
			: null
	});
}

export async function approve(
	ports: Ports,
	ctx: CallContext,
	input: ToolInput<'approve'>
): Promise<Result<ToolOutput<'approve'>>> {
	const r = await ports.store.transact<Approval['state']>(ctx.workspaceId, async (_tx, state) => {
		const a = state.approvals[input.approvalId];
		if (!a) return { error: err('NOT_FOUND', `approval ${input.approvalId}`).error };
		const plan = state.plans[a.planId];
		if (a.state !== 'pending')
			return { error: err('STALE_VERSION', `approval is ${a.state}`).error };
		if (
			input.planVersion !== a.planVersion ||
			input.termsHash !== a.termsHash ||
			plan?.version !== a.planVersion ||
			plan?.termsHash !== a.termsHash
		)
			return {
				error: err('TERMS_CHANGED', 'the plan changed since this approval was shown').error
			};
		const expired = new Date(a.expiresAt).getTime() <= ports.clock.now().getTime();
		const next: Approval = {
			...a,
			state: expired ? 'expired' : input.decision === 'grant' ? 'granted' : 'denied',
			decidedBy: ctx.actor
		};
		return { ops: [pending(ctx, { type: 'RecordApproval', approval: next })], value: next.state };
	});
	return r.ok ? ok({ state: r.value.value }) : r;
}

export async function commitOrder(
	ports: Ports,
	ctx: CallContext,
	input: ToolInput<'commit_order'>
): Promise<Result<ToolOutput<'commit_order'>>> {
	// A line id twice would buy it twice under one approval: refuse before anything is read or written.
	if (input.lineIds && new Set(input.lineIds).size !== input.lineIds.length)
		return err('INVALID_INPUT', 'lineIds must be unique');
	const pre = await ports.store.load(ctx.workspaceId, ctx.runId);
	const plan0 = pre.plans[input.planId];
	if (!plan0) return err('NOT_FOUND', `plan ${input.planId}`);
	const kitchen = await kitchenOf(ports, ctx, plan0.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${plan0.kitchenId}`);
	const openIds = [
		...new Set(plan0.lines.filter((l) => l.state !== 'committed').map((l) => l.productId))
	];
	const { offers } = await ports.catalog.offers(openIds, plan0.deliverBy); // fresh terms, outside the lock
	const products = await ports.catalog.get(openIds);
	const week = isoWeek(plan0.deliverBy);

	return idempotent(ports, ctx, 'commit_order', input.idempotencyKey, input, async (tx, state) => {
		const plan = state.plans[input.planId];
		if (!plan) return { error: err('NOT_FOUND', `plan ${input.planId}`).error };
		if (plan.version !== input.version)
			return {
				error: err('STALE_VERSION', `plan is at v${plan.version}, not v${input.version}`).error
			};
		const fail = (error: DomainError, extra: PendingOp[] = []) => ({
			ops: [
				...extra,
				pending(ctx, {
					type: 'CommitOrder',
					outcome: {
						result: 'failed',
						planId: plan.id,
						idempotencyKey: input.idempotencyKey,
						error
					}
				})
			],
			value: { ok: false as const, error }
		});

		// Re-quote the open lines; if the terms moved, record the new quote (voids approvals) and fail.
		const spent = await ports.store.lockBudget(tx, {
			workspaceId: ctx.workspaceId,
			kitchenId: kitchen.id,
			week
		});
		const committed = plan.lines.filter((l) => l.state === 'committed');
		const open = plan.lines.filter((l) => l.state !== 'committed');
		const t = tierLines({
			kitchen,
			lines: open.map(draftFromLine),
			offers: new Map(offers.map((o) => [o.productId, o])),
			products,
			weekSpentCents: spent,
			actor: ctx.actor.kind,
			createdBy: plan.createdBy.kind,
			orderedBefore: orderedBefore(state, kitchen),
			recalled: recalledProducts(state),
			committed
		});
		const fresh = await termsHash({ deliverBy: plan.deliverBy, lines: t.termsLines });
		if (fresh !== plan.termsHash) {
			const q = await quoteOps(ctx, ports, plan, kitchen, t, offers);
			return fail(
				err('TERMS_CHANGED', 'price or availability changed since the quote; re-approve').error,
				q.ops
			);
		}
		// Same terms, but a line the agent could commit alone is now held (e.g. this week's spend moved since the
		// quote): record the new tiers, open the approval, and say why, so the plan never shows it as committable.
		const tiered = new Map(t.lines.map((l) => [l.id, l]));
		const demoted = plan.lines.filter(
			(l) => l.state === 'eligible' && tiered.get(l.id)?.state === 'held'
		);
		if (demoted.length) {
			const q = await quoteOps(ctx, ports, plan, kitchen, t, offers);
			const cap = tiered.get(demoted[0].id)!.reasons.find((r) => r.startsWith('CAP_EXCEEDED'));
			return fail(
				cap
					? err('CAP_EXCEEDED', `${cap}: needs a human since the quote`, { sub: cap.split('.')[1] })
							.error
					: err('FORBIDDEN', 'held since the quote: needs a granted approval', {
							sub: 'approval_required'
						}).error,
				q.ops
			);
		}

		// Which lines, under which authority.
		const approval = currentApproval(state, plan.id);
		const granted = approval?.state === 'granted' ? approval : null;
		const byId = new Map(plan.lines.map((l) => [l.id, l]));
		const external =
			ctx.actor.kind === 'external_agent' || plan.createdBy.kind === 'external_agent';
		// A line the agent may commit alone: eligible, act tier, and not for an external caller.
		const actAlone = (l: { state: string; tier?: string }) =>
			!external && l.state === 'eligible' && l.tier === 'act';
		const actIds = plan.lines.filter((l) => l.state === 'eligible' && l.tier === 'act').map((l) => l.id);
		// With a granted approval the commit buys what it covers plus the lines inside the mandate, so a plan with
		// both is bought in one press and no in-mandate line is left behind.
		const selected = (
			input.lineIds ?? (granted ? [...new Set([...granted.lineIds, ...actIds])] : actIds)
		).filter((id) => byId.get(id)?.state !== 'committed');
		if (selected.length === 0)
			return fail(
				plan.lines.some((l) => l.state === 'held')
					? err('FORBIDDEN', 'the open lines are held and need a granted approval', {
							sub: 'approval_required'
						}).error
					: err('INVALID_INPUT', 'no open line to commit').error
			);
		if (selected.some((id) => !byId.has(id)))
			return fail(err('NOT_FOUND', 'unknown line id').error);
		// Revalidate exactly what is being bought against the fresh quote: rules and facts, never an approval, decide.
		const requoted = new Map(t.lines.map((l) => [l.id, l]));
		const lines = selected.map((id) => requoted.get(id) ?? byId.get(id)!);
		for (const l of lines) {
			if (l.state === 'unorderable')
				return fail(
					err('FORBIDDEN', `${l.productId} is ruled out: ${l.reasons.join(', ')}`, {
						sub: 'rule',
						detail: { lineId: l.id, reasons: l.reasons }
					}).error
				);
			if (!l.offer?.price || l.lineCents === null)
				return fail(
					err('UNKNOWN_REQUIRED', `${l.productId} has no price: it cannot be ordered`, {
						sub: 'price',
						detail: { lineId: l.id }
					}).error
				);
			if (l.reasons.includes('INSUFFICIENT_STOCK'))
				return fail(
					err(
						'INSUFFICIENT_STOCK',
						`${l.productId}: not enough stock for ${l.qty.value} ${l.qty.unit}`,
						{
							detail: { lineId: l.id }
						}
					).error
				);
		}
		const inMandate = lines.every(actAlone);
		const totalCents = lines.reduce((s, l) => s + l.lineCents!, 0);
		let authority: Order['authority'];
		if (inMandate) {
			if (spent + totalCents > kitchen.mandate.weeklyCapCents)
				return fail(err('CAP_EXCEEDED', 'weekly cap', { sub: 'weekly' }).error);
			authority = 'mandate';
		} else {
			if (!granted || !lines.every((l) => granted.lineIds.includes(l.id) || actAlone(l)))
				return fail(
					err('FORBIDDEN', 'these lines need a granted approval', { sub: 'approval_required' })
						.error
				);
			if (
				granted.mandateVersion !== kitchen.mandate.version ||
				new Date(granted.expiresAt) <= ports.clock.now()
			)
				return fail(err('TERMS_CHANGED', 'approval expired or the mandate changed').error);
			authority = { approvalId: granted.id };
		}

		const offerById = new Map(offers.map((o) => [o.productId, o]));
		// Consume simulated stock atomically; on a shortfall, put back what was taken and fail.
		const taken: { productId: string; qty: number }[] = [];
		const confirmed: Receipt['confirmed'] = [];
		const awaiting: Receipt['awaitingSupplier'] = [];
		for (const l of lines) {
			const c = await ports.simulator.consume(
				tx,
				l.productId,
				l.qty.value,
				offerById.get(l.productId)
			);
			if (!c.ok) {
				for (const back of taken) await ports.simulator.consume(tx, back.productId, -back.qty);
				return fail(c.error);
			}
			if (c.value.confirmed) {
				taken.push({ productId: l.productId, qty: l.qty.value });
				confirmed.push({
					productId: l.productId,
					qty: l.qty,
					...(c.value.lotId ? { lotId: c.value.lotId } : {})
				});
			} else awaiting.push({ productId: l.productId, qty: l.qty });
		}

		const now = ports.clock.now().toISOString();
		const orderId = `or-${await short(`${plan.id}|${input.idempotencyKey}`)}`;
		const order: Order = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: orderId,
			planId: plan.id,
			planVersion: plan.version,
			kitchenId: kitchen.id,
			lines: lines.map((l) => ({
				lineId: l.id,
				productId: l.productId,
				qty: l.qty,
				unitCents: l.offer!.price!.unitCents,
				lineCents: l.lineCents!
			})),
			totalCents,
			termsHash: plan.termsHash!,
			deliverBy: plan.deliverBy,
			committedBy: ctx.actor,
			committedAt: now,
			idempotencyKey: input.idempotencyKey,
			authority
		};
		const receipt: Receipt = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: `rc-${orderId.slice(3)}`,
			orderId,
			confirmed,
			awaitingSupplier: awaiting,
			at: now,
			provenance: { source: 'simulator', note: 'simulated supplier confirmation' }
		};
		await ports.store.addSpend(
			tx,
			{ workspaceId: ctx.workspaceId, kitchenId: kitchen.id, week },
			totalCents
		);
		return {
			ops: [
				pending(
					ctx,
					{ type: 'CommitOrder', outcome: { result: 'committed', order, receipt } },
					input.idempotencyKey
				)
			],
			value: ok({
				orderId,
				receiptId: receipt.id,
				totalCents,
				committedLineIds: lines.map((l) => l.id),
				awaitingSupplier: awaiting.map((a) => a.productId)
			})
		};
	});
}
