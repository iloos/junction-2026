/**
 * Eval gate for evals/scenarios: a fresh PGlite run per scenario, steps played through the real tool handlers
 * (createHandlers), then the end state assembled from the op log. Histories (line/plan/approval states) come from
 * replaying the persisted ops through applyOps, so they show exactly what the store recorded.
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { clearIdempotency } from '$lib/server/demo/idempotency';
import {
	SCOPES_BY_ACTOR,
	toolSchemas,
	type Line,
	type OpEnvelope,
	type Plan,
	type ToolName
} from '$lib/core/contracts';
import { needIdFor } from '$lib/core/demand';
import { isoWeek } from '$lib/core/mandate/tier';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { AVAILABILITY_WORDING } from '$lib/core/services/wording';
import { applyOps, emptyState, type WorkspaceState } from '$lib/core/state';
import * as schema from '../db/schema';
import { createDbPorts } from '../store/db-ports';
import type {
	AttemptOutcome,
	EndState,
	LineView,
	PlanView,
	Scenario,
	Step
} from '../../../../evals/types';

type Kind = keyof typeof SCOPES_BY_ACTOR;
type ProposeSubstituteOp = Extract<OpEnvelope['op'], { type: 'ProposeSubstitute' }>;
/* eslint-disable @typescript-eslint/no-explicit-any -- scenario step inputs are free-form JSON */

export async function playScenario(s: Scenario): Promise<EndState> {
	const valioCallIds: string[] = [];
	/** Ports for one run; `reset` builds the next run's on the same database, as the sandbox reset does. */
	const open = async (o: Parameters<typeof createDbPorts>[0] = {}) => {
		const e = await createDbPorts({ now: s.clock, ...o });
		const offers = e.ports.catalog.offers.bind(e.ports.catalog);
		e.ports.catalog = {
			...e.ports.catalog,
			offers: async (ids, d) => {
				const r = await offers(ids, d);
				valioCallIds.push(...r.offers.map((x) => x.productId));
				return r;
			}
		};
		return e;
	};
	let env = await open();
	env.overlay.clear();
	let ports = env.ports;
	let h: ToolHandlers = createHandlers(ports);
	let runs = 1;
	const ctx = (kind: Kind): CallContext => ({
		workspaceId: env.workspaceId,
		runId: env.runId,
		actor: { kind, id: `${kind}-1` },
		scopes: SCOPES_BY_ACTOR[kind],
		via: 'eval'
	});
	const kitchenId = s.seeds.kitchen;

	for (const o of (s.overrides?.availability ?? []) as any[])
		env.overlay.setAvailability({ productId: o.productId, amount: o.amount, label: o.label });
	for (const o of (s.overrides?.price ?? []) as any[])
		env.overlay.setPrice({ productId: o.productId, unitCents: o.priceCents, label: o.label });
	if (s.state?.weekSpentCents) {
		const week = (s.state as any).budgetWeek ?? isoWeek(s.clock.slice(0, 10));
		await ports.store.transact(env.workspaceId, async (tx) => {
			const k = { workspaceId: env.workspaceId, kitchenId, week };
			await ports.store.lockBudget(tx, k);
			await ports.store.addSpend(tx, k, s.state!.weekSpentCents!);
			return { ops: [], value: null };
		});
	}

	const attempts: AttemptOutcome[] = [];
	const planKeys = new Map<string, string>(); // scenario key (idempotency key / event) → plan id
	let recomputeMs: number | undefined;
	const load = () => ports.store.load(env.workspaceId, env.runId);
	const recall = async (productId: string) => {
		const r = await ports.store.transact(env.workspaceId, async () => ({
			ops: [
				{
					workspaceId: env.workspaceId,
					runId: env.runId,
					actor: { kind: 'system' as const, id: 'recall-watch' },
					via: 'eval:recall',
					op: {
						type: 'RecordAnomaly' as const,
						anomaly: {
							workspaceId: env.workspaceId,
							runId: env.runId,
							id: `recall-${productId}`,
							kind: 'recall' as const,
							productId,
							message: `Recall notice names ${productId} (simulated)`,
							detectedAt: s.clock,
							provenance: { source: 'simulator' as const, note: 'eval recall notice' }
						}
					}
				}
			],
			value: null
		}));
		if (!r.ok) throw new Error(`recall ${productId}: ${r.error.message}`);
	};
	const record = (i: number, step: Step, r: any, extra: Partial<AttemptOutcome> = {}) =>
		attempts.push({
			step: i,
			action: step.action,
			actor: step.actor,
			idempotencyKey: step.input.idempotencyKey as string | undefined,
			result: r.ok ? (r.value?.receiptId ? 'receipt' : 'ok') : 'error',
			error: r.ok ? undefined : r.error.code,
			retryable: r.ok ? undefined : r.error.retryable,
			receiptId: r.ok ? r.value?.receiptId : undefined,
			...extra
		});
	const planFor = async (ref: unknown): Promise<Plan | undefined> => {
		const st = await load();
		const plans = Object.values(st.plans);
		if (typeof ref === 'string' && ref.startsWith('plan:'))
			return st.plans[planKeys.get(ref.slice(5)) ?? ''];
		if (ref && typeof ref === 'object' && 'productId' in (ref as any))
			return plans.find((p) => p.lines.some((l) => l.productId === (ref as any).productId));
		return plans[plans.length - 1];
	};

	for (const [i, step] of s.steps.entries()) {
		const c = ctx(step.actor as Kind);
		const inp = step.input as any;
		switch (step.action) {
			case 'search':
				record(i, step, await h.search_products(c, { query: inp.query, limit: 10 }));
				break;
			case 'quote': {
				const r = await h.quote(c, {
					productIds: inp.productIds,
					...(inp.deliverBy ? { deliverBy: inp.deliverBy } : {})
				});
				record(i, step, r, {
					closingTimes: r.ok
						? r.value.offers.flatMap((o) => o.availability.closingTime ?? [])
						: undefined
				});
				if (r.ok)
					for (const id of r.value.notFound)
						attempts.push({
							step: i,
							action: 'quote',
							actor: step.actor,
							productId: id,
							result: 'error',
							error: 'NOT_FOUND',
							retryable: false
						});
				break;
			}
			case 'place_order': {
				const r = await h.place_order(c, {
					kitchenId,
					deliverBy: inp.deliverBy,
					idempotencyKey: inp.idempotencyKey,
					lines: inp.lines
				});
				record(i, step, r);
				if (r.ok && !planKeys.has(inp.idempotencyKey))
					planKeys.set(inp.idempotencyKey, r.value.plan.id);
				break;
			}
			case 'plan_event': {
				const r = await h.plan_event(
					c,
					inp.proposal ? { kitchenId, proposal: inp.proposal } : { kitchenId, eventId: inp.eventId }
				);
				record(i, step, r);
				if (r.ok) planKeys.set(inp.eventId ?? inp.proposal.id, r.value.plan.id);
				break;
			}
			case 'edit_line': {
				const plan = await planFor(undefined);
				// A proposal's ingredient is addressed by its stable id, which the need id must carry (lineage, R6 §1).
				const byIngredient = inp.ingredientId
					? plan?.needs.find((n) => n.id.includes(inp.ingredientId))?.id
					: undefined;
				if (!plan || (inp.ingredientId && !byIngredient)) {
					record(i, step, {
						ok: false,
						error: { code: 'NOT_FOUND', retryable: false }
					});
					break;
				}
				const t0 = performance.now();
				const r = await h.edit_line(c, {
					planId: plan.id,
					version: plan.version,
					needId: byIngredient ?? (inp.dish ? needIdFor(inp.dish) : undefined),
					lineId: inp.lineId,
					patch: inp.field === 'gServed' ? { gramsPerGuest: inp.value } : { [inp.field]: inp.value }
				});
				recomputeMs = performance.now() - t0;
				record(i, step, r);
				break;
			}
			case 'find_substitutes': {
				const plan = await planFor({ productId: inp.productId });
				const line = plan?.lines.find((l) => l.productId === inp.productId);
				const r =
					plan && line
						? await h.find_substitutes(c, {
								planId: plan.id,
								version: plan.version,
								lineId: line.id,
								apply: inp.apply,
								weights: inp.weights,
								requireOrigin: inp.requireOrigin
							})
						: { ok: false as const, error: { code: 'NOT_FOUND', retryable: false } };
				record(i, step, r, {
					productId: inp.productId,
					...(r.ok
						? {
								applied: r.value.applied,
								chosen: r.value.chosen.map((l) => l.productId),
								kind: r.value.kind
							}
						: {})
				});
				break;
			}
			case 'approve': {
				const plan = await planFor(inp.ref);
				const view = plan ? await h.get_plan(c, { planId: plan.id }) : null;
				const a = view?.ok ? view.value.approval : null;
				const r = a
					? await h.approve(c, {
							approvalId: a.id,
							planVersion: a.planVersion,
							termsHash: a.termsHash,
							decision: 'grant'
						})
					: { ok: false, error: { code: 'NOT_FOUND', retryable: false } };
				record(i, step, r);
				break;
			}
			case 'commit': {
				const plan = await planFor(inp.ref);
				const lineIds =
					inp.ref && typeof inp.ref === 'object' && inp.ref.productId
						? plan?.lines
								.filter((l) => l.productId === inp.ref.productId && l.state !== 'committed')
								.map((l) => l.id)
						: undefined;
				const r = plan
					? await h.commit_order(c, {
							planId: plan.id,
							version: plan.version,
							idempotencyKey: inp.idempotencyKey,
							lineIds
						})
					: { ok: false, error: { code: 'NOT_FOUND', retryable: false } };
				record(i, step, r);
				break;
			}
			case 'set_price':
				env.overlay.setPrice({
					productId: inp.productId,
					unitCents: inp.priceCents,
					label: inp.label
				});
				break;
			case 'set_availability':
				env.overlay.setAvailability({
					productId: inp.productId,
					amount: inp.amount,
					label: inp.label
				});
				break;
			case 'recall':
				await recall(inp.productId);
				break;
			case 'set_clock': {
				// Move the simulator clock (handlers read ports.clock on every call).
				const t = new Date(inp.at);
				ports.clock = { now: () => t };
				break;
			}
			case 'reset': {
				// A fresh run on the same database and workspace; the old run's ops stay for audit.
				runs++;
				await clearIdempotency(env.db, env.workspaceId); // as demo/reset.ts resetDemoRun does
				env = await open({ db: env.db, runId: `run-eval-${runs}`, overlay: env.overlay });
				ports = env.ports;
				h = createHandlers(ports);
				planKeys.clear();
				break;
			}
			default:
				attempts.push({
					step: i,
					action: step.action,
					actor: step.actor,
					result: 'error',
					error: 'INVALID_INPUT',
					retryable: false
				});
		}
	}

	// Replay the persisted op log to recover histories.
	const rows = await env.db
		.select()
		.from(schema.ops)
		.where(eq(schema.ops.runId, env.runId))
		.orderBy(asc(schema.ops.seq));
	const envelopes = rows.map((r) => r.envelope as OpEnvelope);
	let st: WorkspaceState = emptyState(env.workspaceId, env.runId);
	const lineHistory = new Map<string, { states: string[]; reasons: string[] }>();
	const planHistory = new Map<string, string[]>();
	const approvalStates: string[] = [];
	const approvalSeen = new Map<string, string>();
	const push = <T>(arr: T[], v: T) => arr[arr.length - 1] !== v && arr.push(v);
	for (const e of envelopes) {
		const r = applyOps(st, [e]);
		if (!r.ok) throw new Error(`op ${e.seq} does not replay: ${r.error.message}`);
		st = r.value;
		for (const p of Object.values(st.plans)) {
			const ph = planHistory.get(p.id) ?? [];
			if (p.state !== 'draft') push(ph, p.state);
			planHistory.set(p.id, ph);
			for (const l of p.lines) {
				const lh = lineHistory.get(l.id) ?? { states: [], reasons: [] };
				if (l.state !== 'proposed') push(lh.states, l.state);
				for (const reason of l.reasons) if (!lh.reasons.includes(reason)) lh.reasons.push(reason);
				lineHistory.set(l.id, lh);
			}
		}
		for (const a of Object.values(st.approvals))
			if (approvalSeen.get(a.id) !== a.state) {
				approvalSeen.set(a.id, a.state);
				approvalStates.push(a.state);
			}
	}

	const final = await load();
	const plans = Object.values(final.plans);
	const needKg = (p: Plan, l: Line) => {
		const n = p.needs.find((x) => x.id === l.needId);
		return n && n.amount.unit === 'kg' ? n.amount.value : undefined;
	};
	const lines: LineView[] = plans.flatMap((p) =>
		p.lines.map((l) => {
			const a = l.offer?.availability;
			return {
				productId: l.productId,
				qty: l.qty.value,
				unit: l.qty.unit,
				needKg: needKg(p, l),
				state: l.state,
				tier: l.tier,
				reasons: l.reasons,
				priceCents: l.offer?.price?.unitCents,
				lineCents: l.lineCents ?? undefined,
				deliveryDate: p.deliverBy,
				historyStates: lineHistory.get(l.id)?.states,
				historyReasons: lineHistory.get(l.id)?.reasons,
				pickable: l.state === 'eligible' || l.state === 'held',
				substituteFor: l.substituteFor,
				closingTime: l.offer?.availability.closingTime ?? undefined,
				labels:
					a?.provenance.source === 'simulator' ? [`simulated: ${a.provenance.note ?? ''}`] : []
			};
		})
	);
	// Candidates rejected during substitute searches, and the ranking per need.
	const ranking: Record<string, string[]> = {};
	const availabilityKinds: Record<string, string> = {};
	for (const p of plans)
		for (const l of p.lines)
			if (l.offer) availabilityKinds[l.productId] = l.offer.availability.kind;
	for (const e of envelopes)
		if (e.op.type === 'ProposeSubstitute') {
			const op = e.op as ProposeSubstituteOp;
			const plan = final.plans[op.planId];
			const forLine = plan?.lines.find((l) => l.id === op.forLineId);
			const need = plan?.needs.find((n) => n.id === forLine?.needId);
			const label = need?.label ?? forLine?.productId ?? op.forLineId;
			ranking[label] = op.candidates
				.filter((c) => c.rank !== null)
				.sort((a, b) => a.rank! - b.rank!)
				.map((c) => c.productId);
			for (const c of op.candidates) {
				const kind = c.rejectedReasons.find((r) => r in AVAILABILITY_WORDING);
				if (kind) availabilityKinds[c.productId] ??= kind;
				if (c.rejectedReasons.length)
					lines.push({
						productId: c.productId,
						state: 'rejected',
						reasons: c.rejectedReasons,
						pickable: false
					});
			}
		}

	const covered = (p: Plan, needId?: string) =>
		p.lines.some((l) => l.needId === needId && l.state !== 'unorderable' && l.state !== 'rejected');
	const residualShortfall = plans.flatMap((p) =>
		p.lines
			.filter((l) => l.state === 'unorderable' && l.needId && !covered(p, l.needId))
			.map((l) => {
				const n = p.needs.find((x) => x.id === l.needId)!;
				return {
					dish: n.label,
					[n.amount.unit === 'pcs' ? 'pieces' : n.amount.unit]: n.amount.value
				};
			})
	);
	const unconfirmed = new Set<string>();
	for (const p of plans)
		for (const l of p.lines)
			if (
				l.offer?.availability.kind === 'unknown' &&
				(l.state === 'held' || l.state === 'committed' || l.state === 'eligible')
			)
				unconfirmed.add(l.productId);

	const planViews: PlanView[] = plans.map((p) => {
		const key = [...planKeys.entries()].find(([, id]) => id === p.id)?.[0] ?? p.id;
		const reasons = [...new Set(p.lines.flatMap((l) => l.reasons))];
		const tiers = p.lines.map((l) => l.tier).filter(Boolean);
		return {
			key,
			totalCents: p.totalCents ?? 0,
			state: p.state,
			states: planHistory.get(p.id) ?? [],
			tier: tiers.includes('sign_off')
				? 'sign_off'
				: tiers.includes('propose')
					? 'propose'
					: tiers[0],
			reasons
		};
	});

	const budgets = await env.db
		.select()
		.from(schema.budgets)
		.where(and(eq(schema.budgets.kitchenId, kitchenId), eq(schema.budgets.runId, env.runId)));
	const whyFor = (s.expect.why as { productId?: string } | undefined)?.productId;
	const why: Record<string, string[]> = {};
	if (whyFor) {
		const p = plans.find((x) => x.lines.some((l) => l.productId === whyFor));
		const l = p?.lines.find((x) => x.productId === whyFor);
		const r = p && l ? await h.explain_line(ctx('chef'), { planId: p.id, lineId: l.id }) : null;
		if (r?.ok) why[whyFor] = r.value.steps.map((x) => x.text);
	}
	const external = SCOPES_BY_ACTOR.external_agent as readonly string[];
	const newest = plans[plans.length - 1];
	const current = newest ? await h.get_plan(ctx('chef'), { planId: newest.id }) : null;
	const ap = current?.ok ? current.value.approval : null;
	const fv = current?.ok ? current.value.plan.view?.fulfilment : undefined;
	const fulfilment = fv?.map((f) => ({
		label: f.label,
		status: f.status,
		unit: f.required.unit,
		required: f.required.value,
		partitionSum:
			f.supplierConfirmed.value +
			f.awaitingSupplier.value +
			f.plannedKnown.value +
			f.plannedUnknown.value +
			f.unresolved.value,
		unresolved: f.unresolved.value,
		supplierConfirmed: f.supplierConfirmed.value
	}));
	const lastVoided = current?.ok
		? current.value.lastVoided?.diff.map((d) => ({ productId: d.productId, change: d.change }))
		: undefined;
	const approval = ap
		? {
				state: ap.state,
				productIds: newest!.lines.filter((l) => ap.lineIds.includes(l.id)).map((l) => l.productId)
			}
		: null;
	const previousRunOps = (
		await env.db
			.select({ seq: schema.ops.seq })
			.from(schema.ops)
			.where(and(eq(schema.ops.workspaceId, env.workspaceId), ne(schema.ops.runId, env.runId)))
	).length;

	return {
		lines,
		linesAfterEdit: lines,
		plans: planViews,
		attempts,
		receipts: Object.values(final.receipts).map((r) => ({
			id: r.id,
			idempotencyKey: final.orders[r.orderId]?.idempotencyKey
		})),
		approvalStates,
		weekSpentCents: budgets.reduce((sum, b) => sum + b.spentCents, 0),
		residualShortfall,
		unconfirmedCover: [...unconfirmed],
		availabilityKinds,
		ranking,
		ops: envelopes.map((e) => ({
			op: e.op.type,
			actor: e.actor.kind,
			...(e.op.type === 'RecordApproval' ? { approvalState: e.op.approval.state } : {})
		})),
		valioCallIds,
		why,
		externalAgentTools: (Object.keys(toolSchemas) as ToolName[]).filter((t) =>
			external.includes(toolSchemas[t].scope)
		),
		wording: AVAILABILITY_WORDING,
		recomputeMs,
		approval,
		fulfilment,
		lastVoided,
		orderLines: Object.values(final.orders).flatMap((o) =>
			o.lines.map((l) => ({
				productId: l.productId,
				authority: !l.authority
					? ('unrecorded' as const)
					: l.authority === 'mandate'
						? ('mandate' as const)
						: ('approval' as const)
			}))
		),
		previousRunOps
	};
}
