/**
 * The Operations work queue: every thing a person or agent must act on, one case per cause in a plan, sorted by
 * urgency. Pure: derived from the reduced WorkspaceState (with plan views when /ops has them) plus when each line
 * was first held.
 */
import type { Line, Plan } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import type { WorkspaceState } from '$lib/core/state';
import { decisionsOf, type Decision } from '$lib/ui/decisions';
import { dueOf } from '$lib/core/mandate/due';
import { productName, reasonText, type Names } from './labels';

/** The plan's pending approval, if any (the one decisions are counted from). */
export function pendingApprovalOf(s: WorkspaceState, planId: string) {
	return Object.values(s.approvals).find((a) => a.planId === planId && a.state === 'pending');
}

/**
 * The state as a person reads it: a held line that a granted approval of its plan's current version covers is
 * approved and orderable now, so it shows as eligible, not as waiting for someone. Lines stay `held` in the reducer
 * until the commit; without this, Problems and the Queue would say "waits for the chef" after the chef said yes.
 */
export function withApprovals(s: WorkspaceState): WorkspaceState {
	const granted = new Set<string>();
	for (const a of Object.values(s.approvals)) {
		const plan = s.plans[a.planId];
		if (a.state === 'granted' && plan && a.planVersion === plan.version)
			for (const id of a.lineIds) granted.add(`${a.planId}:${id}`);
	}
	if (!granted.size) return s;
	const plans: Record<string, Plan> = {};
	for (const [id, p] of Object.entries(s.plans))
		plans[id] = p.lines.some((l) => l.state === 'held' && granted.has(`${id}:${l.id}`))
			? {
					...p,
					lines: p.lines.map((l) =>
						l.state === 'held' && granted.has(`${id}:${l.id}`) ? { ...l, state: 'eligible' } : l
					)
				}
			: p;
	return { ...s, plans };
}

/** Decisions waiting for a person across plans, the way the kitchen counts them. */
export function openDecisions(s: WorkspaceState, plans: Plan[]): Decision[] {
	return plans.flatMap((p) => decisionsOf(p, pendingApprovalOf(s, p.id)));
}

export type Owner = 'Chef' | 'Approver' | 'Kitchen agent' | 'Operations';
export type Tone = 'blocked' | 'sign_off' | 'propose' | 'act';

export interface Case {
	id: string;
	kitchenId: string;
	planId?: string;
	version?: number;
	/** The first line's need, for the kitchen deep link. */
	needId?: string;
	title: string;
	detail?: string;
	/** The lines this case stands for (one cause in one plan); empty for anomalies and refusals. */
	lines: { id: string; name: string; detail: string }[];
	causes: string[];
	state: string;
	owner: Owner;
	next: string;
	tone: Tone;
	/** When it must be done by (ISO): dueOf over its lines (core/mandate/due.ts), else the scenario cut-off. */
	deadline: string | null;
	/** When it became a case (ISO, op time): its longest-waiting line. */
	since: string | null;
}

/** Deadline as epoch ms (ISO strings can carry different offsets); no deadline sorts last. */
const due = (c: Case) => (c.deadline ? new Date(c.deadline).getTime() : Infinity);

const TONE_RANK: Record<Tone, number> = { blocked: 0, sign_off: 1, propose: 2, act: 3 };

/** Key for `heldSince`: one entry per plan line. */
export const lineKey = (planId: string, lineId: string) => `${planId}:${lineId}`;

const EPS = 1e-9;
/** Lines that still stand for their need: an alternative in any of these states answers an outage. */
const LIVE: ReadonlySet<Line['state']> = new Set(['proposed', 'eligible', 'held', 'committed']);

/**
 * Whether a line still needs someone. Held lines always do. A line that cannot be ordered stops being a case once
 * its need is answered: the plan view says nothing is unresolved, or (without a view) another line for the same
 * need is live (a rescue's substitute or make-in-house lines). A held alternative is its own case, so the outage
 * is not counted twice.
 */
export function isOpen(plan: Plan, l: Line): boolean {
	if (l.state === 'held') return true;
	if (l.state !== 'unorderable') return false;
	const f = plan.view?.fulfilment.find((x) => x.needId === l.needId);
	if (f && f.unresolved.value <= EPS) return false;
	return !plan.lines.some(
		(x) =>
			x.id !== l.id &&
			LIVE.has(x.state) &&
			(x.substituteFor === l.productId || (!!l.needId && x.needId === l.needId))
	);
}

/** The lines of a plan that are cases now (see `isOpen`). */
export const openLines = (plan: Plan) => plan.lines.filter((l) => isOpen(plan, l));

type Shape = Pick<Case, 'state' | 'owner' | 'next' | 'tone'>;

function shapeOf(l: Line, pending: boolean): Shape {
	if (l.state === 'unorderable')
		return {
			state: 'Cannot be ordered',
			owner: 'Kitchen agent',
			next: 'Find a substitute or make in house',
			tone: 'blocked'
		};
	if (l.tier === 'sign_off')
		return {
			state: pending ? 'Sign-off requested' : 'Held for sign-off',
			owner: 'Approver',
			next: 'Sign off or deny the exact lines',
			tone: 'sign_off'
		};
	return {
		state: pending ? 'Confirmation requested' : 'Held for the chef',
		owner: 'Chef',
		next: 'Confirm, edit or swap',
		tone: 'propose'
	};
}

const earliest = (a: string | null, b: string | null) =>
	!a ? b : !b ? a : new Date(a).getTime() <= new Date(b).getTime() ? a : b;

export function buildCases(
	s: WorkspaceState,
	names: Names,
	heldSince: Record<string, string>
): Case[] {
	const pendingLines = new Set<string>();
	for (const a of Object.values(s.approvals))
		if (a.state === 'pending') for (const id of a.lineIds) pendingLines.add(lineKey(a.planId, id));

	// Lines in a pending approval are cases per decision, exactly as the kitchen counts them (decisionsOf):
	// one reason group of the approval, in the same words. Other open lines group by state and reasons.
	const decisionOf = new Map<string, Decision>();
	for (const plan of Object.values(s.plans))
		for (const d of decisionsOf(plan, pendingApprovalOf(s, plan.id)))
			for (const id of d.lineIds) decisionOf.set(lineKey(plan.id, id), d);

	const groups = new Map<string, Case>();
	for (const plan of Object.values(s.plans))
		for (const l of openLines(plan)) {
			const shape = shapeOf(l, pendingLines.has(lineKey(plan.id, l.id)));
			const d = l.state === 'held' ? decisionOf.get(lineKey(plan.id, l.id)) : undefined;
			const causes = d ? d.reason.split(' · ') : l.reasons.map(reasonText);
			const key = d
				? `${plan.id}|decision|${d.key}`
				: `${plan.id}|${shape.state}|${[...causes].sort().join(',')}`;
			if (d && d.signOff) Object.assign(shape, shapeOf({ ...l, tier: 'sign_off' }, true));
			const name = productName(names, l.productId);
			const replaces = l.substituteFor ? `, replaces ${productName(names, l.substituteFor)}` : '';
			const detail = `${l.qty.value} ${l.qty.unit}${replaces}`;
			const deadline = dueOf(plan, pendingApprovalOf(s, plan.id), [l]) ?? SCENARIO.cutoff;
			const since = heldSince[lineKey(plan.id, l.id)] ?? null;
			const c = groups.get(key);
			if (c) {
				c.lines.push({ id: l.id, name, detail });
				c.deadline = earliest(c.deadline, deadline);
				c.since = earliest(c.since, since);
				continue;
			}
			groups.set(key, {
				id: `group:${key}`,
				kitchenId: plan.kitchenId,
				planId: plan.id,
				version: plan.version,
				needId: l.needId,
				title: name,
				lines: [{ id: l.id, name, detail }],
				causes,
				...shape,
				deadline,
				since
			});
		}
	const out: Case[] = [...groups.values()].map((c) => {
		if (c.lines.length === 1) return { ...c, detail: c.lines[0].detail };
		const names2 = c.lines.slice(0, 2).map((x) => x.name);
		const more = c.lines.length > 2 ? ', …' : '';
		return { ...c, title: `${c.lines.length} lines: ${names2.join(', ')}${more}` };
	});

	const linked = new Set(out.map((c) => c.planId));
	for (const a of Object.values(s.anomalies)) {
		const plan = a.planId ? s.plans[a.planId] : undefined;
		if (plan && linked.has(plan.id)) continue; // already visible through its open lines
		out.push({
			id: `anomaly:${a.id}`,
			kitchenId: plan?.kitchenId ?? '',
			planId: plan?.id,
			version: plan?.version,
			title: a.message,
			lines: [],
			causes: [a.kind.replaceAll('_', ' ')],
			state: 'Detected',
			owner: 'Operations',
			next: 'Check which orders it touches',
			tone: 'blocked',
			deadline: SCENARIO.cutoff,
			since: a.detectedAt
		});
	}

	// One refusal case per plan (its latest), and none once the plan has committed.
	const refused = new Map<string, WorkspaceState['failedCommits'][number]>();
	for (const f of s.failedCommits)
		if ((refused.get(f.planId)?.seq ?? -1) < f.seq) refused.set(f.planId, f);
	for (const f of refused.values()) {
		const plan = s.plans[f.planId];
		if (!plan || plan.state === 'committed') continue;
		out.push({
			id: `refused:${f.planId}`,
			kitchenId: plan.kitchenId,
			planId: plan.id,
			version: plan.version,
			title: 'Order refused',
			lines: [],
			causes: [reasonText(f.code)],
			state: 'Refused',
			owner: 'Kitchen agent',
			next: 'Get the approval, then commit again',
			tone: 'blocked',
			deadline: SCENARIO.cutoff,
			since: null
		});
	}

	return out.sort(
		(a, b) =>
			due(a) - due(b) ||
			TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
			(a.since ?? '9').localeCompare(b.since ?? '9')
	);
}

/**
 * Coverage of a kitchen's needs, from each plan's FulfilmentView (the one definition, shared with get_plan and the
 * kitchen): a need is covered when nothing is unresolved and nothing rests on supply of unknown quantity (D10).
 * Plans without a view (the simulated run) are not counted; null when no plan reports one.
 */
export function coverage(plans: Plan[]): { covered: number; total: number } | null {
	let covered = 0;
	let total = 0;
	for (const p of plans)
		for (const f of p.view?.fulfilment ?? []) {
			total += 1;
			if (f.unresolved.value <= EPS && f.plannedUnknown.value <= EPS) covered += 1;
		}
	return total ? { covered, total } : null;
}

/**
 * Where the kitchen shows this case: the exact workspace, run, plan, version and need. `ws` moves the
 * kitchen into the same room (server/demo/visitor.ts); a link from an older run finds no such plan there.
 */
export function kitchenHref(
	c: Pick<Case, 'kitchenId' | 'planId' | 'version' | 'needId'>,
	at?: { ws: string; run: string | null }
): string | null {
	if (!c.planId) return null;
	const q = new URLSearchParams();
	if (at) {
		q.set('ws', at.ws);
		if (at.run) q.set('run', at.run);
	}
	q.set('kitchen', c.kitchenId);
	q.set('plan', c.planId);
	if (c.version !== undefined) q.set('v', String(c.version));
	if (c.needId) q.set('need', c.needId);
	return `/?${q}`;
}
