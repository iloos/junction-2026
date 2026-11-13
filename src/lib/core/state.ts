import { err, ok, type Result } from './contracts/errors';
import type { Approval, Anomaly, Order, Plan, Receipt } from './contracts/plan';
import type { OpEnvelope } from './contracts/ops';
import type { Provenance } from './contracts/primitives';

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
		failedCommits: []
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
				const lines = op.line
					? plan.lines.some((l) => l.id === op.lineId)
						? plan.lines.map((l) => (l.id === op.lineId ? op.line! : l))
						: [...plan.lines, op.line]
					: plan.lines.filter((l) => l.id !== op.lineId);
				const next: Plan = {
					...plan,
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
					approvals: termsChanged ? invalidateApprovals(s, plan.id) : s.approvals
				};
				break;
			}
			case 'ProposeSubstitute': {
				const r = checkVersion(s, op.planId, op.baseVersion);
				if (!r.ok) return r;
				const plan = r.value;
				const lines = op.line ? [...plan.lines, op.line] : plan.lines;
				const next: Plan = {
					...plan,
					lines,
					version: plan.version + 1,
					state: 'draft',
					termsHash: null
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
				if (prev && prev.state !== 'pending' && prev.state !== a.state)
					return err('STALE_VERSION', `approval ${a.id} is already ${prev.state}`);
				if (a.state === 'granted' && a.decidedBy?.kind === 'external_agent')
					return err('FORBIDDEN', 'an external agent cannot approve');
				const plan = s.plans[a.planId];
				if (!plan) return err('NOT_FOUND', `plan ${a.planId}`);
				if (
					a.state === 'granted' &&
					(plan.version !== a.planVersion || plan.termsHash !== a.termsHash)
				)
					return err('TERMS_CHANGED', `approval ${a.id} no longer matches plan ${plan.id}`);
				s = { ...s, approvals: { ...s.approvals, [a.id]: a } };
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
				if (plan.state === 'committed')
					return err('DUPLICATE', `plan ${plan.id} already committed`);
				if (plan.version !== o.order.planVersion || plan.termsHash !== o.order.termsHash)
					return err('TERMS_CHANGED', `order does not match plan ${plan.id} v${plan.version}`);
				const committed = new Set(o.order.lines.map((l) => l.lineId));
				const next: Plan = {
					...plan,
					state: 'committed',
					lines: plan.lines.map((l) => (committed.has(l.id) ? { ...l, state: 'committed' } : l))
				};
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
		}
		s = { ...s, seq: env.seq };
	}
	return ok(s);
}
