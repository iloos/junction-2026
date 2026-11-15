import { err, ok, type Result } from './contracts/errors';
import type { Approval, Anomaly, Order, Plan, Receipt } from './contracts/plan';
import type { OpEnvelope } from './contracts/ops';
import type { Actor, Provenance } from './contracts/primitives';

/** Everything one workspace run knows. Reduced from the op log; the store also persists it as rows. */
export interface WorkspaceState {
	workspaceId: string;
	runId: string;
	/** Highest op seq applied. */
	seq: number;
	plans: Record<string, Plan>;
	approvals: Record<string, Approval>;
	orders: Record<string, Order>;
	receipts: Record<string, Receipt>;
	anomalies: Record<string, Anomaly>;
	/** productId → field → suggestion. Enrichments never overwrite catalogue facts. */
	enrichments: Record<string, Record<string, { value: unknown; provenance: Provenance }>>;
	/** Failed commit attempts, kept as outcomes (D6). */
	failedCommits: { planId: string; idempotencyKey: string; code: string; seq: number }[];
	/** Calls the gate refused (RecordRefusal), in seq order. */
	refusals: { seq: number; tool: string; code: string; actor: Actor; planId?: string }[];
}

export function emptyState(workspaceId: string, runId: string): WorkspaceState {
	return {
		workspaceId,
		runId,
		seq: 0,
		plans: {},
		approvals: {},
		orders: {},
		receipts: {},
		anomalies: {},
		enrichments: {},
		failedCommits: [],
		refusals: []
	};
}

function checkVersion(state: WorkspaceState, planId: string, baseVersion: number): Result<Plan> {
	const plan = state.plans[planId];
	if (!plan) return err('NOT_FOUND', `plan ${planId}`);
	if (plan.version !== baseVersion)
		return err(
			'STALE_VERSION',
			`plan ${planId} is at v${plan.version}, op was computed on v${baseVersion}`
		);
	if (plan.state === 'committed') return err('STALE_VERSION', `plan ${planId} is committed`);
	return ok(plan);
}

/** Pending/granted approvals for a plan become `invalidated` when its terms change. */
function invalidateApprovals(state: WorkspaceState, planId: string): Record<string, Approval> {
	const out = { ...state.approvals };
	for (const a of Object.values(out))
		if (a.planId === planId && (a.state === 'pending' || a.state === 'granted'))
			out[a.id] = { ...a, state: 'invalidated', reason: 'plan changed' };
	return out;
}

/**
 * A re-quote with the same terms moves the plan to a new version, and the quote records a fresh pending approval at
 * it. An older version's pending approval would then be a second, stale decision for the same lines, so it goes;
 * a grant on the same terms stays.
 */
function supersedePending(state: WorkspaceState, planId: string): Record<string, Approval> {
	const out = { ...state.approvals };
	for (const a of Object.values(out))
		if (a.planId === planId && a.state === 'pending')
			out[a.id] = { ...a, state: 'invalidated', reason: 'superseded by a re-quote' };
	return out;
}

/**
 * Who may commit which lines (★5/★7). Every order line is checked against the authority it names (an order line
 * without one names the order's). `mandate`: only `act`-tier eligible lines, never for
 * an external caller or an externally created plan. An approval: granted, bound to this exact plan version and
 * terms, and covering that line.
 */
function commitAuthority(
	state: WorkspaceState,
	plan: Plan,
	order: Order,
	actorKind: string
): Result<true> {
	if (plan.version !== order.planVersion || plan.termsHash !== order.termsHash)
		return err('TERMS_CHANGED', `order does not match plan ${plan.id} v${plan.version}`);
	const byId = new Map(plan.lines.map((l) => [l.id, l]));
	const external = actorKind === 'external_agent' || plan.createdBy.kind === 'external_agent';
	const usable = (approvalId: string): Result<Approval> => {
		const approval = state.approvals[approvalId];
		if (!approval || approval.planId !== plan.id) return err('NOT_FOUND', 'approval');
		if (approval.state !== 'granted')
			return err('TERMS_CHANGED', `approval ${approval.id} is ${approval.state}`);
		if (approval.planVersion !== plan.version || approval.termsHash !== plan.termsHash)
			return err('TERMS_CHANGED', `approval ${approval.id} no longer matches the plan`);
		return ok(approval);
	};
	if (order.authority !== 'mandate') {
		const a = usable(order.authority.approvalId);
		if (!a.ok) return a;
	}
	for (const ol of order.lines) {
		const line = byId.get(ol.lineId);
		if (!line) return err('NOT_FOUND', `line ${ol.lineId}`);
		if (line.state === 'committed') return err('DUPLICATE', `line ${ol.lineId} already committed`);
		const auth = ol.authority ?? order.authority;
		if (auth === 'mandate') {
			if (!external && line.state === 'eligible' && line.tier === 'act') continue;
			return err('FORBIDDEN', `line ${ol.lineId} is outside the mandate and needs an approval`);
		}
		const a = usable(auth.approvalId);
		if (!a.ok) return a;
		if (a.value.lineIds.includes(ol.lineId)) continue;
		return err('FORBIDDEN', `approval ${auth.approvalId} does not cover line ${ol.lineId}`);
	}
	return ok(true);
}

/**
 * The one way state changes (CLAUDE.md rule 3). Pure: validates each op against the current state and reduces.
 * Authorisation, locking, stock consumption and persistence are the server command handler's job.
 */
export function applyOps(state: WorkspaceState, ops: OpEnvelope[]): Result<WorkspaceState> {
	let s = state;
	for (const env of ops) {
		if (env.workspaceId !== s.workspaceId || env.runId !== s.runId)
			return err('FORBIDDEN', `op ${env.seq} belongs to another workspace or run`);
		if (env.seq <= s.seq) return err('STALE_VERSION', `op seq ${env.seq} ≤ applied ${s.seq}`);
		const op = env.op;
		switch (op.type) {
			case 'CreatePlan': {
				if (s.plans[op.plan.id]) return err('DUPLICATE', `plan ${op.plan.id} exists`);
				s = { ...s, plans: { ...s.plans, [op.plan.id]: op.plan } };
				break;
			}
			case 'EditLine': {
				const r = checkVersion(s, op.planId, op.baseVersion);
				if (!r.ok) return r;
				const plan = r.value;
				let lines = plan.lines;
				for (const e of op.lines) {
					const prev = lines.find((l) => l.id === e.lineId);
					if (prev?.state === 'committed')
						return err('STALE_VERSION', `line ${e.lineId} is committed and can't be edited`);
					lines = e.line
						? prev
							? lines.map((l) => (l.id === e.lineId ? e.line! : l))
							: [...lines, e.line]
						: lines.filter((l) => l.id !== e.lineId);
				}
				const needs = op.need
					? plan.needs.some((n) => n.id === op.need!.id)
						? plan.needs.map((n) => (n.id === op.need!.id ? op.need! : n))
						: [...plan.needs, op.need]
					: plan.needs;
				const next: Plan = {
					...plan,
					needs,
					lines,
					version: plan.version + 1,
					state: 'draft',
					termsHash: null,
					totalCents: null
				};
				s = {
					...s,
					plans: { ...s.plans, [plan.id]: next },
					approvals: invalidateApprovals(s, plan.id)
				};
				break;
			}
			case 'RecordOffer': {
				const r = checkVersion(s, op.planId, op.baseVersion);
				if (!r.ok) return r;
				const plan = r.value;
				const kept = new Map(op.lines.map((l) => [l.id, l]));
				for (const l of plan.lines)
					if (l.state === 'committed' && kept.get(l.id)?.state !== 'committed')
						return err('STALE_VERSION', `quote dropped committed line ${l.id}`);
				const termsChanged = plan.termsHash !== null && plan.termsHash !== op.termsHash;
				const next: Plan = {
					...plan,
					lines: op.lines,
					state: op.planState,
					totalCents: op.totalCents,
					termsHash: op.termsHash,
					version: plan.version + 1
				};
				s = {
					...s,
					plans: { ...s.plans, [plan.id]: next },
					approvals: termsChanged ? invalidateApprovals(s, plan.id) : supersedePending(s, plan.id)
				};
				break;
			}
			case 'ProposeSubstitute': {
				const r = checkVersion(s, op.planId, op.baseVersion);
				if (!r.ok) return r;
				const plan = r.value;
				const next: Plan = {
					...plan,
					lines: [...plan.lines, ...op.lines],
					version: plan.version + 1,
					state: 'draft',
					termsHash: null,
					totalCents: null
				};
				s = {
					...s,
					plans: { ...s.plans, [plan.id]: next },
					approvals: invalidateApprovals(s, plan.id)
				};
				break;
			}
			case 'RecordApproval': {
				const a = op.approval;
				const prev = s.approvals[a.id];
				// A deny may be taken back on the same plan version (approve 'reopen'); nothing else leaves a decision.
				const reopen =
					prev?.state === 'denied' &&
					a.state === 'pending' &&
					s.plans[a.planId]?.version === a.planVersion;
				if (prev && prev.state !== 'pending' && prev.state !== a.state && !reopen)
					return err('STALE_VERSION', `approval ${a.id} is already ${prev.state}`);
				// A decision may narrow an approval to one group of its lines, never widen it.
				if (prev && a.lineIds.some((id) => !prev.lineIds.includes(id)))
					return err('FORBIDDEN', `approval ${a.id} cannot take lines it did not list`);
				if (a.state === 'granted' && a.decidedBy?.kind === 'external_agent')
					return err('FORBIDDEN', 'an external agent cannot approve');
				const plan = s.plans[a.planId];
				if (!plan) return err('NOT_FOUND', `plan ${a.planId}`);
				if (
					a.state === 'granted' &&
					(plan.version !== a.planVersion || plan.termsHash !== a.termsHash)
				)
					return err('TERMS_CHANGED', `approval ${a.id} no longer matches plan ${plan.id}`);
				// Grants on this version that together cover every held line make the plan ready to commit.
				const held = plan.lines.filter((l) => l.state === 'held').map((l) => l.id);
				const covered = new Set(
					[...Object.values(s.approvals).filter((x) => x.id !== a.id), a]
						.filter(
							(x) => x.planId === plan.id && x.state === 'granted' && x.planVersion === plan.version
						)
						.flatMap((x) => x.lineIds)
				);
				const ready =
					a.state === 'granted' && plan.state === 'held' && held.every((id) => covered.has(id));
				s = {
					...s,
					approvals: { ...s.approvals, [a.id]: a },
					plans: ready ? { ...s.plans, [plan.id]: { ...plan, state: 'ready' } } : s.plans
				};
				break;
			}
			case 'CommitOrder': {
				const o = op.outcome;
				if (o.result === 'failed') {
					s = {
						...s,
						failedCommits: [
							...s.failedCommits,
							{
								planId: o.planId,
								idempotencyKey: o.idempotencyKey,
								code: o.error.code,
								seq: env.seq
							}
						]
					};
					break;
				}
				const plan = s.plans[o.order.planId];
				if (!plan) return err('NOT_FOUND', `plan ${o.order.planId}`);
				const auth = commitAuthority(s, plan, o.order, env.actor.kind);
				if (!auth.ok) return auth;
				const committed = new Set(o.order.lines.map((l) => l.lineId));
				const lines = plan.lines.map((l) =>
					committed.has(l.id) ? { ...l, state: 'committed' as const } : l
				);
				const open = lines.some(
					(l) => l.state === 'proposed' || l.state === 'eligible' || l.state === 'held'
				);
				const next: Plan = { ...plan, lines, state: open ? plan.state : 'committed' };
				s = {
					...s,
					plans: { ...s.plans, [plan.id]: next },
					orders: { ...s.orders, [o.order.id]: o.order },
					receipts: { ...s.receipts, [o.receipt.id]: o.receipt }
				};
				break;
			}
			case 'RecordAnomaly': {
				s = { ...s, anomalies: { ...s.anomalies, [op.anomaly.id]: op.anomaly } };
				const pid = op.anomaly.productId;
				if (op.anomaly.kind === 'recall' && pid) {
					// Every uncommitted line of the recalled product is held for sign-off and its approval voided.
					const plans = { ...s.plans };
					let approvals = s.approvals;
					for (const plan of Object.values(s.plans)) {
						const hit = plan.lines.some(
							(l) => l.productId === pid && l.state !== 'committed' && l.state !== 'unorderable'
						);
						if (!hit) continue;
						plans[plan.id] = {
							...plan,
							version: plan.version + 1,
							state: 'held',
							lines: plan.lines.map((l) =>
								l.productId === pid && l.state !== 'committed' && l.state !== 'unorderable'
									? {
											...l,
											state: 'held' as const,
											tier: 'sign_off' as const,
											reasons: l.reasons.includes('recall')
												? l.reasons
												: [...l.reasons, 'recall' as const]
										}
									: l
							)
						};
						approvals = invalidateApprovals({ ...s, approvals }, plan.id);
					}
					s = { ...s, plans, approvals };
				}
				break;
			}
			case 'RecordEnrichment': {
				const prev = s.enrichments[op.productId] ?? {};
				s = {
					...s,
					enrichments: {
						...s.enrichments,
						[op.productId]: { ...prev, [op.field]: { value: op.value, provenance: op.provenance } }
					}
				};
				break;
			}
			case 'RecordRefusal':
				// A refused call changes nothing but the record of refusals.
				s = {
					...s,
					refusals: [
						...s.refusals,
						{
							seq: env.seq,
							tool: op.tool,
							code: op.code,
							actor: env.actor,
							...(op.planId ? { planId: op.planId } : {})
						}
					]
				};
				break;
		}
		s = { ...s, seq: env.seq };
	}
	return ok(s);
}
