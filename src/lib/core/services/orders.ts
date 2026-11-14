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
	type Need,
	type Offer,
	type Order,
	type PendingOp,
	type Plan,
	type Product,
	type Receipt,
	type Result,
	type SalesQty,
	type TermsDiff,
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
import { roundToLots, seedNeedQty, sizeDirect, type EventSeed } from '../demand';
import type { WorkspaceState } from '../state';

const APPROVAL_TTL_MS = 24 * 3600 * 1000;

const short = async (s: string) => (await sha256Hex(s)).slice(0, 12);

/** The one op envelope builder: who, through what, for which agent run (initiatedBy), and the op. */
export function pending(ctx: CallContext, op: PendingOp['op'], idempotencyKey?: string): PendingOp {
	return {
		workspaceId: ctx.workspaceId,
		runId: ctx.runId,
		actor: ctx.actor,
		via: ctx.via,
		...(ctx.initiatedBy ? { initiatedBy: ctx.initiatedBy } : {}),
		idempotencyKey,
		op
	};
}

export async function kitchenOf(
	ports: Ports,
	ctx: CallContext,
	id: string
): Promise<Kitchen | null> {
	return (await ports.store.kitchens(ctx.workspaceId)).find((k) => k.id === id) ?? null;
}

/**
 * Rounds a requested quantity up to the product's lot step (D6: allowedLotSize is a hard minimum and step).
 * Zero stays zero: nothing is needed, so nothing is bought (tiering marks the line rejected).
 */
export function toLot(qty: number, unit: string, p: Product): DraftLine['qty'] {
	if (qty <= 0) return { value: 0, unit };
	const step = p.lotStep;
	if (step <= 0.01) return { value: qty, unit };
	const { lots, value } = roundToLots(qty, step);
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
			expiresAt: new Date(ports.clock.now().getTime() + APPROVAL_TTL_MS).toISOString(),
			// What the approver is shown, kept so a voided approval can say what changed (lastVoided).
			bound: {
				lines: t.lines.map((l) => ({
					lineId: l.id,
					productId: l.productId,
					...(l.productName ? { productName: l.productName } : {}),
					qty: l.qty,
					unitCents: l.offer?.price?.unitCents ?? null,
					state: l.state
				})),
				needs: plan.needs.map((n) => ({ needId: n.id, amount: n.amount }))
			}
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
	// A physical amount is the demand authority (F10): the server sizes it, and a qty that disagrees is refused.
	const sized: (SalesQty | null)[] = [];
	for (const [i, l] of input.lines.entries()) {
		if (!l.amount) {
			sized.push(null);
			continue;
		}
		const p = products.get(l.productId)!;
		const s = sizeDirect(p, l.amount);
		if (!s)
			return err(
				'INVALID_INPUT',
				`lines[${i}]: ${l.productId} has no known ${l.amount.unit} content per ${p.salesUnit}; give qty in ${p.salesUnit} without amount`,
				{ detail: { line: i } }
			);
		if (Math.abs(s.value - l.qty) > 1e-9 || l.unit !== s.unit)
			return err(
				'INVALID_INPUT',
				`lines[${i}]: ${l.amount.value} ${l.amount.unit} of ${l.productId} is ${s.value} ${s.unit}, not ${l.qty} ${l.unit}`,
				{ detail: { line: i, computedQty: s.value, unit: s.unit } }
			);
		sized.push(s);
	}
	const { offers } = await ports.catalog.offers(ids, input.deliverBy); // outside the lock (D6)
	const planId = `pl-${ctx.runId}-${await short(`${ctx.actor.id}|${input.idempotencyKey}`)}`;
	const needs: Need[] = input.lines.flatMap((l, i): Need[] =>
		l.amount
			? [
					{
						id: `need:direct-${i + 1}`,
						label: `${l.amount.value} ${l.amount.unit} ${products.get(l.productId)!.nameFi}`,
						kind: 'direct' as const,
						amount: l.amount,
						...(l.requirements
							? { requirements: l.requirements, requirementsFrom: 'request' as const }
							: {}),
						...(l.ask ? { ask: l.ask } : {}),
						provenance: { source: 'user' as const, note: `${ctx.actor.kind} via ${ctx.via}` }
					}
				]
			: l.requirements || l.ask
				? [
						// D18: packs, cases or sales units with no stated content still make a need, in sales units, so the
						// ask and its requirements live on through substitutes and edits.
						{
							id: `need:sales-${i + 1}`,
							label: `${l.qty} ${l.unit} ${products.get(l.productId)!.nameFi}`,
							kind: 'sales' as const,
							amount: { value: l.qty, unit: 'pcs' as const },
							ask: l.ask ?? { qty: l.qty, unit: 'sales_unit' as const },
							...(l.requirements
								? { requirements: l.requirements, requirementsFrom: 'request' as const }
								: {}),
							provenance: { source: 'user' as const, note: `${ctx.actor.kind} via ${ctx.via}` }
						}
					]
				: []
	);

	return idempotent(ports, ctx, 'place_order', input.idempotencyKey, input, async (tx, state) => {
		const spent = await ports.store.lockBudget(tx, {
			workspaceId: ctx.workspaceId,
			kitchenId: kitchen.id,
			week: isoWeek(input.deliverBy)
		});
		const drafts: DraftLine[] = input.lines.map((l, i) => ({
			id: `${planId}-l${i + 1}`,
			...(l.amount
				? { needId: `need:direct-${i + 1}` }
				: l.requirements || l.ask
					? { needId: `need:sales-${i + 1}` }
					: {}),
			productId: l.productId,
			qty: sized[i] ?? toLot(l.qty, l.unit, products.get(l.productId)!),
			provenance: { source: 'user', note: `${ctx.actor.kind} via ${ctx.via}` }
		}));
		const t = tierLines({
			now: ports.clock.now(),
			kitchen,
			lines: drafts,
			offers: new Map(offers.map((o) => [o.productId, o])),
			products,
			weekSpentCents: spent,
			actor: ctx.actor.kind,
			createdBy: ctx.actor.kind,
			orderedBefore: orderedBefore(state, kitchen),
			recalled: recalledProducts(state),
			needs,
			orderRequirements: input.requirements,
			deliverBy: input.deliverBy
		});
		const plan0: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: planId,
			kitchenId: kitchen.id,
			version: 0,
			state: 'draft',
			deliverBy: input.deliverBy,
			...(input.requirements ? { requirements: input.requirements } : {}),
			needs,
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

const LIVE_ORDER: Record<string, number> = { pending: 0, granted: 1, denied: 2 };
const TIER_ORDER = { act: 0, propose: 1, sign_off: 2 } as const;
const strictest = (tiers: (keyof typeof TIER_ORDER)[]) =>
	tiers.reduce(
		(a, b) => (TIER_ORDER[b] > TIER_ORDER[a] ? b : a),
		'propose' as keyof typeof TIER_ORDER
	);

/**
 * The approvals of a plan's current version that still mean something: pending, granted and denied. After a
 * per-group decision there are several (one per group); before it, at most one.
 */
export function liveApprovals(state: WorkspaceState, planId: string): Approval[] {
	const plan = state.plans[planId];
	if (!plan) return [];
	return Object.values(state.approvals)
		.filter((a) => a.planId === planId && a.planVersion === plan.version && a.state in LIVE_ORDER)
		.sort((a, b) => LIVE_ORDER[a.state] - LIVE_ORDER[b.state] || (a.id < b.id ? -1 : 1));
}

/** The approval to show: the pending one if any group still waits, else a granted one (newest version first). */
export function currentApproval(state: WorkspaceState, planId: string): Approval | null {
	return (
		Object.values(state.approvals)
			.filter((a) => a.planId === planId && (a.state === 'pending' || a.state === 'granted'))
			.sort(
				(a, b) =>
					b.planVersion - a.planVersion ||
					LIVE_ORDER[a.state] - LIVE_ORDER[b.state] ||
					(a.id < b.id ? -1 : 1)
			)[0] ?? null
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
	const voided = Object.values(state.approvals)
		.filter((x) => x.planId === plan.id && x.state === 'invalidated' && x.bound)
		.sort((x, y) => y.planVersion - x.planVersion || (x.id < y.id ? 1 : -1))[0];
	return ok({
		lastVoided: voided ? { approvalId: voided.id, diff: termsDiff(voided.bound!, plan) } : null,
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
	const r = await ports.store.transact<{
		state: Approval['state'];
		remainingApprovalId: string | null;
	}>(ctx.workspaceId, async (_tx, state) => {
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
		const decided = expired ? 'expired' : input.decision === 'grant' ? 'granted' : 'denied';
		// One reason group (lineIds): those lines keep this id and take the decision; the rest wait in a new pending
		// approval on the same version and terms. Deciding every line is the whole approval.
		const subset = input.lineIds;
		if (subset?.some((id) => !a.lineIds.includes(id)))
			return {
				error: err('INVALID_INPUT', `lineIds must be lines of approval ${a.id}`, {
					detail: { lineIds: a.lineIds }
				}).error
			};
		const rest = subset && !expired ? a.lineIds.filter((id) => !subset.includes(id)) : [];
		const next: Approval = {
			...a,
			...(rest.length ? { lineIds: a.lineIds.filter((id) => subset!.includes(id)) } : {}),
			state: decided,
			decidedBy: ctx.actor
		};
		const ops = [pending(ctx, { type: 'RecordApproval', approval: next })];
		let remainingApprovalId: string | null = null;
		if (rest.length) {
			remainingApprovalId = `${a.id}-${await short(rest.join('|'))}`;
			const held = new Map(plan!.lines.map((l) => [l.id, l]));
			ops.push(
				pending(ctx, {
					type: 'RecordApproval',
					approval: {
						...a,
						id: remainingApprovalId,
						lineIds: rest,
						tier: strictest(rest.map((id) => held.get(id)?.tier ?? a.tier)),
						state: 'pending'
					}
				})
			);
		}
		return { ops, value: { state: decided, remainingApprovalId } };
	});
	return r.ok
		? ok({
				state: r.value.value.state,
				...(input.lineIds ? { remainingApprovalId: r.value.value.remainingApprovalId } : {})
			})
		: r;
}

export async function commitOrder(
	ports: Ports & { events?: Record<string, EventSeed> },
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
		// The caller's fence, under the lock: a purchase whose task was cancelled meanwhile writes nothing.
		const stop = ctx.fence ? await ctx.fence(tx) : null;
		if (stop) return { error: err('FORBIDDEN', stop, { sub: 'cancelled' }).error };
		let plan = state.plans[input.planId];
		if (!plan) return { error: err('NOT_FOUND', `plan ${input.planId}`).error };
		/** Ops recorded before the commit itself (a re-quote that closed lines past their cut-off). */
		let prefix: PendingOp[] = [];
		if (plan.version !== input.version)
			return {
				error: err('STALE_VERSION', `plan is at v${plan.version}, not v${input.version}`).error
			};
		const fail = (error: DomainError, extra: PendingOp[] = []) => ({
			ops: [
				...prefix,
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
		const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
		const t = tierLines({
			now: ports.clock.now(),
			kitchen,
			lines: open.map(draftFromLine),
			offers: new Map(offers.map((o) => [o.productId, o])),
			products,
			weekSpentCents: spent,
			actor: ctx.actor.kind,
			createdBy: plan.createdBy.kind,
			orderedBefore: orderedBefore(state, kitchen),
			recalled: recalledProducts(state),
			committed,
			// The same yardstick as the quote, so a line held for its quantity stays held here.
			expectedQty: seed ? seedNeedQty(plan.id, seed) : undefined,
			needs: plan.needs,
			orderRequirements: plan.requirements,
			deliverBy: plan.deliverBy
		});
		// F9: lines whose cut-off has passed (scenario clock) can't be bought. Named explicitly, the commit is refused by
		// name. Otherwise the re-quote is recorded (they show closed; the changed terms void any approval) and the commit
		// goes on with the lines the mandate still covers alone; approved lines need approving again.
		const wanted = (id: string) =>
			input.lineIds
				? input.lineIds.includes(id)
				: plan.lines.find((l) => l.id === id)?.state !== 'unorderable';
		const closed = t.lines.filter((l) => l.reasons.includes('cutoff_passed') && wanted(l.id));
		if (closed.length) {
			const q = await quoteOps(ctx, ports, plan, kitchen, t, offers);
			const at = closed[0].offer?.availability.closingTime;
			const refuse = () =>
				fail(
					err(
						'FORBIDDEN',
						`ordering closed${at ? ` at ${at}` : ''} for ${closed.map((l) => l.productName ?? l.productId).join(', ')}`,
						{ sub: 'cutoff', detail: { lineIds: closed.map((l) => l.id) } }
					).error,
					q.ops
				);
			if (input.lineIds || !t.lines.some((l) => l.state === 'eligible' && l.tier === 'act'))
				return refuse();
			prefix = q.ops;
			plan = q.plan;
		}
		// D16: a line whose product breaks a hard requirement is never bought. Named, or with nothing else to buy, the
		// commit is refused with which requirement and which product fact, so a caller can repair it.
		const unmet = t.lines.filter(
			(l) =>
				l.state !== 'committed' &&
				l.reasons.includes('requirement_unmet') &&
				(input.lineIds ? input.lineIds.includes(l.id) : true)
		);
		const buyable = t.lines.some(
			(l) =>
				(l.state === 'eligible' || l.state === 'held') && !l.reasons.includes('requirement_unmet')
		);
		if (unmet.length && (input.lineIds || !buyable))
			return fail(
				err(
					'FORBIDDEN',
					`${unmet.map((l) => l.productName ?? l.productId).join(', ')} ${unmet.length === 1 ? 'does' : 'do'} not meet ${
						unmet
							.flatMap((l) => (l.unmet ?? []).map((c) => c.requirement))
							.filter((v, i, a) => a.indexOf(v) === i)
							.join(', ') || 'a hard requirement'
					}`,
					{
						sub: 'requirement_unmet',
						detail: {
							lines: unmet.map((l) => ({
								lineId: l.id,
								productId: l.productId,
								unmet: l.unmet ?? []
							}))
						}
					}
				).error,
				prefix
			);
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
		// Every granted group of this version covers its own lines (approve{lineIds}); one grant is the usual case.
		// After a recorded re-quote the plan's approvals are void (its terms moved).
		const grants = prefix.length
			? []
			: liveApprovals(state, plan.id).filter((a) => a.state === 'granted');
		const grantFor = (lineId: string) => grants.find((a) => a.lineIds.includes(lineId));
		const byId = new Map(plan.lines.map((l) => [l.id, l]));
		const external =
			ctx.actor.kind === 'external_agent' || plan.createdBy.kind === 'external_agent';
		// A line the agent may commit alone: eligible, act tier, and not for an external caller.
		const actAlone = (l: { state: string; tier?: string }) =>
			!external && l.state === 'eligible' && l.tier === 'act';
		const actIds = plan.lines
			.filter((l) => l.state === 'eligible' && l.tier === 'act')
			.map((l) => l.id);
		// With a granted approval the commit buys what it covers plus the lines inside the mandate, so a plan with
		// both is bought in one press and no in-mandate line is left behind.
		const selected = (
			input.lineIds ??
			(grants.length ? [...new Set([...grants.flatMap((a) => a.lineIds), ...actIds])] : actIds)
		).filter((id) => byId.get(id)?.state !== 'committed');
		// Everything asked for is already bought (a concurrent commit with another key won): a conflict, not bad input.
		const lost = input.lineIds
			? input.lineIds.every((id) => byId.get(id)?.state === 'committed')
			: plan.lines.some((l) => l.state === 'committed') &&
				!plan.lines.some((l) => l.state === 'held' || l.state === 'eligible');
		// Already ordered: the lines asked for (or, unnamed, every bought line with nothing left open) are all in one
		// order of this plan on the accepted terms. A retry whose recomputed key differs gets that receipt, not an
		// error. Split across orders, other terms, or held lines still open: no replay (a new command stays new).
		if (selected.length === 0 && lost && prefix.length === 0) {
			const want =
				input.lineIds ?? plan.lines.filter((l) => l.state === 'committed').map((l) => l.id);
			const covering = Object.values(state.orders).filter(
				(o) =>
					o.planId === plan.id &&
					o.termsHash === plan.termsHash &&
					want.every((id) => o.lines.some((x) => x.lineId === id))
			);
			const receipt =
				covering.length === 1
					? Object.values(state.receipts).find((r) => r.orderId === covering[0].id)
					: undefined;
			if (receipt)
				return {
					ops: [],
					value: ok({
						orderId: covering[0].id,
						receiptId: receipt.id,
						totalCents: covering[0].totalCents,
						committedLineIds: covering[0].lines.map((l) => l.lineId),
						awaitingSupplier: receipt.awaitingSupplier.map((a) => a.productId),
						replayed: true
					})
				};
		}
		if (selected.length === 0 && lost)
			return fail(
				err('STALE_VERSION', 'these lines were already committed by another order; reload the plan')
					.error
			);
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
			if (l.state === 'rejected')
				return fail(
					err('INVALID_INPUT', `${l.productId}: quantity is 0, nothing to buy`, {
						detail: { lineId: l.id }
					}).error
				);
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
			// Each line outside the mandate needs a grant that lists it; a grant never covers a line it did not list.
			if (!lines.every((l) => grantFor(l.id) || actAlone(l)))
				return fail(
					err('FORBIDDEN', 'these lines need a granted approval', { sub: 'approval_required' })
						.error
				);
			const used = [...new Set(lines.map((l) => grantFor(l.id)).filter((a) => a !== undefined))];
			if (
				used.some(
					(a) =>
						a.mandateVersion !== kitchen.mandate.version ||
						new Date(a.expiresAt) <= ports.clock.now()
				)
			)
				return fail(err('TERMS_CHANGED', 'approval expired or the mandate changed').error);
			authority = { approvalId: used[0].id };
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
				lineCents: l.lineCents!,
				// F8: each line names what allowed it. A line the approval covered names it, even if the mandate
				// alone would have allowed it; an act-tier line bought alongside names the mandate.
				authority: (() => {
					const a = authority !== 'mandate' ? grantFor(l.id) : undefined;
					return a ? { approvalId: a.id } : ('mandate' as const);
				})()
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
				...prefix,
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

const qtyText = (q: { value: number; unit: string }) => `${q.value} ${q.unit}`;
const priceText = (cents: number | null | undefined, unit: string) =>
	cents == null ? 'no price' : `€${(cents / 100).toFixed(2)}/${unit}`;

/**
 * What changed between the terms an approval was shown and the plan now, line by line (by id), plus needs whose
 * amount moved. A need change names the need id in `lineId`.
 */
export function termsDiff(bound: NonNullable<Approval['bound']>, plan: Plan): TermsDiff {
	const out: TermsDiff = [];
	const now = new Map(plan.lines.map((l) => [l.id, l]));
	const was = new Map(bound.lines.map((l) => [l.lineId, l]));
	for (const b of bound.lines) {
		const l = now.get(b.lineId);
		const name = {
			productId: b.productId,
			...(b.productName ? { productName: b.productName } : {})
		};
		if (!l) {
			out.push({ lineId: b.lineId, ...name, change: 'removed', before: qtyText(b.qty) });
			continue;
		}
		if (l.productId !== b.productId)
			out.push({
				lineId: b.lineId,
				...name,
				change: 'product',
				before: b.productName ?? b.productId,
				after: l.productName ?? l.productId
			});
		if (l.qty.value !== b.qty.value || l.qty.unit !== b.qty.unit)
			out.push({
				lineId: b.lineId,
				...name,
				change: 'qty',
				before: qtyText(b.qty),
				after: qtyText(l.qty)
			});
		const cents = l.offer?.price?.unitCents ?? null;
		if (cents !== b.unitCents)
			out.push({
				lineId: b.lineId,
				...name,
				change: 'price',
				before: priceText(b.unitCents, b.qty.unit),
				after: priceText(cents, l.qty.unit)
			});
		if (l.state !== b.state)
			out.push({ lineId: b.lineId, ...name, change: 'state', before: b.state, after: l.state });
	}
	for (const l of plan.lines)
		if (!was.has(l.id))
			out.push({
				lineId: l.id,
				productId: l.productId,
				...(l.productName ? { productName: l.productName } : {}),
				change: 'added',
				after: qtyText(l.qty)
			});
	const needs = new Map(plan.needs.map((n) => [n.id, n]));
	for (const b of bound.needs ?? []) {
		const n = needs.get(b.needId);
		if (n && (n.amount.value !== b.amount.value || n.amount.unit !== b.amount.unit))
			out.push({
				lineId: b.needId,
				change: 'need',
				before: `${b.amount.value} ${b.amount.unit}`,
				after: `${n.amount.value} ${n.amount.unit}`
			});
	}
	return out;
}
