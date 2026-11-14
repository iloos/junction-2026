/**
 * An order's four stages, from the op log: what was asked (the needs and their basis), what the agents proposed
 * and why (outages, substitutes, make-in-house, edits; unchanged lines only counted), what was signed (each
 * approval: lines, plan version, terms, who) and what was ordered (each receipt line: confirmed or awaiting the
 * supplier). Pure: replays the ops with `applyOps` and diffs the plan between them. Nothing is inferred that the
 * log doesn't record.
 */
import type {
	ActorKind,
	Approval,
	Line,
	Measure,
	OpEnvelope,
	Plan,
	PlanOrigin,
	PlanState,
	SalesQty
} from '../contracts';
import { applyOps, emptyState, type WorkspaceState } from '../state';
import { causeOf, type CauseBy } from './cause';
import { liveApprovals } from './orders';

export type Origin = 'chat' | 'request' | 'outside_agent' | 'event' | 'usual' | 'menu' | 'kitchen';

/** The plan's server-set origin (Plan.origin) as an Origin. */
const FROM_PLAN: Record<PlanOrigin, Origin> = {
	event: 'event',
	usual: 'usual',
	request: 'request',
	chat: 'chat',
	agent: 'outside_agent',
	menu: 'menu'
};

export interface StageChange {
	seq: number;
	at: string;
	actor: ActorKind;
	kind:
		| 'out'
		| 'undeliverable'
		| 'rule'
		| 'substitute'
		| 'make_in_house'
		| 'no_substitute'
		| 'edit'
		| 'recall';
	/** For a line that can't be ordered: who imposed it (Valio, the kitchen's rules, the order). */
	by?: CauseBy;
	/** One plain sentence: what changed and why. */
	text: string;
	lineIds: string[];
}

export interface SignedStep {
	approvalId: string;
	seq: number;
	at: string;
	state: Approval['state'];
	tier: Approval['tier'];
	lines: number;
	lineIds: string[];
	planVersion: number;
	termsHash: string;
	requestedBy: ActorKind;
	decidedBy?: ActorKind;
	reason?: string;
}

export interface OrderedLine {
	lineId: string;
	name: string;
	qty: SalesQty;
	lineCents: number;
	status: 'confirmed' | 'awaiting' | 'ordered';
	/** What allowed it: the kitchen's mandate, or an approval and who granted it. */
	authority: { kind: 'mandate' } | { kind: 'approval'; approvalId: string; by?: ActorKind };
}

export interface OrderStages {
	planId: string;
	kitchenId: string;
	deliverBy: string;
	state: PlanState;
	version: number;
	origin: Origin;
	createdBy: ActorKind;
	asked: {
		seq: number;
		at: string;
		needs: {
			needId: string;
			label: string;
			amount: Measure;
			basis: string;
			addedLater?: boolean;
		}[];
		/** A plan ordered by line (no needs): the lines as first asked for. */
		lines: { name: string; qty: SalesQty }[];
	};
	proposed: { changes: StageChange[]; unchanged: number; lines: number };
	signed: SignedStep[];
	ordered: {
		orderId: string;
		seq: number;
		at: string;
		planVersion: number;
		totalCents: number;
		termsHash: string;
		committedBy: ActorKind;
		lines: OrderedLine[];
	}[];
	/** Lines held for a person now, and what they come to. */
	held: { lines: number; cents: number };
	orderedCents: number;
	/** The plan as it stands (for the caller's decisions and titles). */
	plan: Plan;
	/** Its pending approval, if one is open (what a person decides on now). */
	pending: Approval | null;
}

/** "Thu 10 Dec" for a YYYY-MM-DD day. */
const dayText = (d: string) =>
	new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(
		new Date(`${d}T12:00:00Z`)
	);

const name = (l: Pick<Line, 'productId' | 'productName'>) =>
	l.productName ?? `Product ${l.productId}`;

function planIdOf(env: OpEnvelope): string | undefined {
	const op = env.op;
	switch (op.type) {
		case 'CreatePlan':
			return op.plan.id;
		case 'RecordApproval':
			return op.approval.planId;
		case 'CommitOrder':
			return op.outcome.result === 'committed' ? op.outcome.order.planId : op.outcome.planId;
		case 'RecordAnomaly':
			return op.anomaly.planId;
		case 'RecordEnrichment':
			return undefined;
		default:
			return op.planId;
	}
}

function originOf(create: OpEnvelope, plan: Plan): Origin {
	// The door recorded on the plan; older plans (before Plan.origin) are read from who made them and how.
	if (plan.origin) return FROM_PLAN[plan.origin];
	const door = create.via.split(':')[0];
	if (plan.createdBy.kind === 'external_agent' || door === 'mcp' || door === 'rest')
		return 'outside_agent';
	// The agent dock (dock#<tab>) and chat are the chef talking to the agent.
	if (door.startsWith('dock') || create.via.includes('chat') || plan.taskId) return 'chat';
	if (create.via.includes('request')) return 'request';
	if (plan.eventId) return 'event';
	return 'kitchen';
}

function basisOf(n: Plan['needs'][number]): string {
	if (n.dish) return n.dish.formula;
	if (n.unresolved) return `Not yet buyable: ${n.unresolved}`;
	return 'Asked for directly';
}

const WHO: Record<ActorKind, string> = {
	chef: 'The chef',
	approver: 'The approver',
	kitchen_agent: 'The kitchen agent',
	external_agent: 'An outside agent',
	system: 'The system',
	job: 'A monitor job'
};

/** What one replay keeps per plan while it walks the log. */
interface Acc {
	planId: string;
	before?: Plan;
	create?: OpEnvelope;
	first?: Plan;
	/** The first version that had lines (a plan is often created empty and filled by its first offer). */
	firstLined?: Plan;
	askedAt?: OpEnvelope;
	changes: StageChange[];
	approvalOps: Map<string, OpEnvelope>;
	orderOps: Map<string, OpEnvelope>;
}

const newAcc = (planId: string): Acc => ({
	planId,
	changes: [],
	approvalOps: new Map(),
	orderOps: new Map()
});

/** One op applied to its plan's accumulator; `plan` is the plan after the op. */
function step(acc: Acc, env: OpEnvelope, plan: Plan, names: Map<string, string>) {
	for (const l of plan.lines) names.set(l.productId, name(l));
	if (!acc.firstLined && plan.lines.length) acc.firstLined = plan;
	const at = env.at;
	const actor = env.actor.kind;
	const add = (kind: StageChange['kind'], text: string, lineIds: string[], by?: CauseBy) =>
		acc.changes.push({ seq: env.seq, at, actor, kind, text, lineIds, ...(by ? { by } : {}) });
	const op = env.op;
	switch (op.type) {
		case 'CreatePlan':
			acc.create = env;
			acc.first = plan;
			if (plan.needs.length) acc.askedAt = env;
			break;
		case 'RecordOffer': {
			const prev = new Map((acc.before?.lines ?? []).map((l) => [l.id, l]));
			for (const l of plan.lines) {
				if (l.state !== 'unorderable' || prev.get(l.id)?.state === 'unorderable') continue;
				// The cause from the line's typed reasons, and who imposed it: never a kitchen rule as stock.
				const c = causeOf(l);
				add(
					c.reason === 'undeliverable' ? 'undeliverable' : c.shortage ? 'out' : 'rule',
					c.reason === 'undeliverable'
						? `${name(l)} can't be delivered by ${dayText(plan.deliverBy)}, Valio says.`
						: `${name(l)} ${c.text}.`,
					[l.id],
					c.by
				);
			}
			break;
		}
		case 'ProposeSubstitute': {
			const forName = op.lines[0]?.substituteFor
				? (names.get(op.lines[0].substituteFor) ?? `Product ${op.lines[0].substituteFor}`)
				: 'the missing product';
			const ranked = op.candidates.length
				? `, ranked first of ${op.candidates.length} candidates by the kitchen's own rules`
				: '';
			if (!op.lines.length) add('no_substitute', `No substitute for ${forName} qualifies.`, []);
			else if (op.kind === 'make_in_house')
				add(
					'make_in_house',
					`Planned in house instead of ${forName}: ${op.lines.length} ingredient${op.lines.length === 1 ? '' : 's'}${op.labourNote ? `; ${op.labourNote.replace(/\.$/, '')}` : ''}.`,
					op.lines.map((l) => l.id)
				);
			else
				add(
					'substitute',
					`Proposed ${name(op.lines[0])} instead of ${forName}${ranked}.`,
					op.lines.map((l) => l.id)
				);
			break;
		}
		case 'EditLine':
			if (!acc.askedAt && plan.needs.length) acc.askedAt = env;
			add(
				'edit',
				`${WHO[actor]} changed it: ${op.summary.replace(/\.$/, '')}.`,
				op.lines.map((x) => x.lineId)
			);
			break;
		case 'RecordAnomaly':
			if (op.anomaly.kind === 'recall')
				add(
					'recall',
					`Recall notice: ${op.anomaly.message.replace(/\.$/, '')}. Its lines are held until someone checks.`,
					plan.lines.filter((l) => l.productId === op.anomaly.productId).map((l) => l.id)
				);
			break;
		case 'RecordApproval':
			acc.approvalOps.set(op.approval.id, acc.approvalOps.get(op.approval.id) ?? env);
			if (op.approval.state !== 'pending') acc.approvalOps.set(`${op.approval.id}:decided`, env);
			break;
		case 'CommitOrder':
			if (op.outcome.result === 'committed') acc.orderOps.set(op.outcome.order.id, env);
			break;
	}
	acc.before = plan;
}

/** The stages of one plan from its accumulator and the final state. */
function finish(acc: Acc, state: WorkspaceState, names: Map<string, string>): OrderStages | null {
	const { planId, create, first, firstLined, askedAt, changes, approvalOps, orderOps } = acc;
	const plan = state.plans[planId];
	if (!plan || !create || !first) return null;
	const asked = askedAt ? (askedAt === create ? first : plan) : plan;
	const firstNeeds = new Set(asked.needs.map((n) => n.id));

	// Lines whose product and amount are as first planned: counted, not listed.
	const firstLines = new Map((firstLined ?? first).lines.map((l) => [l.id, l]));
	const touched = new Set(changes.flatMap((c) => c.lineIds));
	const unchanged = plan.lines.filter((l) => {
		const f = firstLines.get(l.id);
		return (
			f &&
			!touched.has(l.id) &&
			f.productId === l.productId &&
			f.qty.value === l.qty.value &&
			l.state !== 'unorderable'
		);
	}).length;

	const signed: SignedStep[] = Object.values(state.approvals)
		.filter((a) => a.planId === planId)
		.map((a) => {
			const env = approvalOps.get(`${a.id}:decided`) ?? approvalOps.get(a.id);
			return {
				approvalId: a.id,
				seq: env?.seq ?? 0,
				at: env?.at ?? '',
				state: a.state,
				tier: a.tier,
				lines: a.lineIds.length,
				lineIds: a.lineIds,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				requestedBy: a.requestedBy.kind,
				...(a.decidedBy ? { decidedBy: a.decidedBy.kind } : {}),
				...(a.reason ? { reason: a.reason } : {})
			};
		})
		.sort((a, b) => a.seq - b.seq);

	const ordered = Object.values(state.orders)
		.filter((o) => o.planId === planId)
		.map((o) => {
			const receipt = Object.values(state.receipts).find((r) => r.orderId === o.id);
			const confirmed = new Set((receipt?.confirmed ?? []).map((c) => c.lineId ?? c.productId));
			const awaiting = new Set((receipt?.awaitingSupplier ?? []).map((a) => a.productId));
			const env = orderOps.get(o.id);
			return {
				orderId: o.id,
				seq: env?.seq ?? 0,
				at: env?.at ?? o.committedAt,
				planVersion: o.planVersion,
				totalCents: o.totalCents,
				termsHash: o.termsHash,
				committedBy: o.committedBy.kind,
				lines: o.lines.map((l): OrderedLine => {
					const auth = l.authority ?? o.authority;
					const pl = plan.lines.find((x) => x.id === l.lineId);
					return {
						lineId: l.lineId,
						name: names.get(l.productId) ?? (pl ? name(pl) : `Product ${l.productId}`),
						qty: l.qty,
						lineCents: l.lineCents,
						status:
							confirmed.has(l.lineId) || confirmed.has(l.productId)
								? 'confirmed'
								: awaiting.has(l.productId)
									? 'awaiting'
									: 'ordered',
						authority:
							auth === 'mandate'
								? { kind: 'mandate' }
								: {
										kind: 'approval',
										approvalId: auth.approvalId,
										...(state.approvals[auth.approvalId]?.decidedBy
											? { by: state.approvals[auth.approvalId].decidedBy!.kind }
											: {})
									}
					};
				})
			};
		})
		.sort((a, b) => a.seq - b.seq);

	const heldLines = plan.lines.filter((l) => l.state === 'held');
	return {
		planId,
		kitchenId: plan.kitchenId,
		deliverBy: plan.deliverBy,
		state: plan.state,
		version: plan.version,
		origin: originOf(create, plan),
		createdBy: plan.createdBy.kind,
		asked: {
			seq: (askedAt ?? create).seq,
			at: (askedAt ?? create).at,
			needs: plan.needs.map((n) => {
				const was = asked.needs.find((x) => x.id === n.id) ?? n;
				return {
					needId: n.id,
					label: n.label,
					amount: was.amount,
					basis: basisOf(was),
					...(firstNeeds.has(n.id) ? {} : { addedLater: true })
				};
			}),
			lines: plan.needs.length
				? []
				: (firstLined ?? first).lines.map((l) => ({ name: name(l), qty: l.qty }))
		},
		proposed: { changes, unchanged, lines: plan.lines.length },
		signed,
		ordered,
		held: {
			lines: heldLines.length,
			cents: heldLines.reduce((s, l) => s + (l.lineCents ?? 0), 0)
		},
		orderedCents: ordered.reduce((s, o) => s + o.totalCents, 0),
		plan,
		pending:
			// The current version's pending approval: an older version's, left pending by a same-terms re-quote, is stale.
			liveApprovals(state, planId).find((a) => a.state === 'pending') ?? null
	};
}

/**
 * Every plan in the log, newest first, as stages: one replay of the log with an accumulator per plan. `ops` is
 * the workspace's op log of the run, in seq order; `start` the state the run started from (empty when omitted).
 */
export function allOrderStages(ops: OpEnvelope[], start?: WorkspaceState): OrderStages[] {
	if (!ops.length) return [];
	let state = start ?? emptyState(ops[0].workspaceId, ops[0].runId);
	const accs = new Map<string, Acc>();
	/** Product names seen on any version of any plan, for "instead of X" after X's line is gone. */
	const names = new Map<string, string>();
	for (const env of ops) {
		const r = applyOps(state, [env]);
		if (!r.ok) continue; // a refused op (another run, a stale write) changes nothing
		state = r.value;
		const planId = planIdOf(env);
		if (!planId) continue;
		const plan = state.plans[planId];
		if (!plan) continue;
		let acc = accs.get(planId);
		if (!acc) accs.set(planId, (acc = newAcc(planId)));
		step(acc, env, plan, names);
	}
	return [...accs.values()]
		.filter((a) => a.create)
		.sort((a, b) => b.create!.seq - a.create!.seq)
		.map((a) => finish(a, state, names))
		.filter((s): s is OrderStages => !!s);
}

/** The stages of one plan (one replay of the log, as `allOrderStages`). */
export function orderStages(
	planId: string,
	ops: OpEnvelope[],
	start?: WorkspaceState
): OrderStages | null {
	return allOrderStages(ops, start).find((s) => s.planId === planId) ?? null;
}
