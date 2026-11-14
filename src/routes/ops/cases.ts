/**
 * The Operations work queue (review round 4, #9): every thing a person or agent must act on, as one list
 * sorted by urgency. Pure: derived from the reduced WorkspaceState plus when each line was first held.
 */
import type { Line, Plan } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import type { WorkspaceState } from '$lib/core/state';
import { lineIsHeld, reasonText, type Names } from './labels';

export type Owner = 'Chef' | 'Approver' | 'Kitchen agent' | 'Operations';
export type Tone = 'blocked' | 'sign_off' | 'propose' | 'act';

export interface Case {
	id: string;
	kitchenId: string;
	planId?: string;
	version?: number;
	needId?: string;
	title: string;
	detail?: string;
	causes: string[];
	state: string;
	owner: Owner;
	next: string;
	tone: Tone;
	/** When it must be done by (ISO): the scenario cut-off for the event delivery. */
	deadline: string | null;
	/** When it became a case (ISO, op time). */
	since: string | null;
}

const TONE_RANK: Record<Tone, number> = { blocked: 0, sign_off: 1, propose: 2, act: 3 };

/** Key for `heldSince`: one entry per plan line. */
export const lineKey = (planId: string, lineId: string) => `${planId}:${lineId}`;

function lineCase(
	plan: Plan,
	l: Line,
	pendingLines: Set<string>,
	names: Names,
	since: string | null
): Case {
	const name = names[l.productId] ?? `Product ${l.productId}`;
	const pending = pendingLines.has(lineKey(plan.id, l.id));
	const hasSub = plan.lines.some((x) => x.substituteFor === l.productId);
	const base = {
		id: `line:${lineKey(plan.id, l.id)}`,
		kitchenId: plan.kitchenId,
		planId: plan.id,
		version: plan.version,
		needId: l.needId,
		title: name,
		detail: `${l.qty.value} ${l.qty.unit}${l.substituteFor ? `, replaces ${names[l.substituteFor] ?? l.substituteFor}` : ''}`,
		causes: l.reasons.map(reasonText),
		// The mock's closingTime values are static November dates; the scenario cut-off is the real deadline
		// until core exposes an effective per-line cut-off.
		deadline: SCENARIO.cutoff,
		since
	};
	if (l.state === 'unorderable')
		return {
			...base,
			state: hasSub ? 'Substitute proposed' : 'Cannot be ordered',
			owner: hasSub ? 'Chef' : 'Kitchen agent',
			next: hasSub ? 'Review the substitute' : 'Find a substitute or make in house',
			tone: 'blocked'
		};
	if (l.tier === 'sign_off')
		return {
			...base,
			state: pending ? 'Sign-off requested' : 'Held for sign-off',
			owner: 'Approver',
			next: 'Sign off or deny the exact lines',
			tone: 'sign_off'
		};
	return {
		...base,
		state: pending ? 'Confirmation requested' : 'Held for the chef',
		owner: 'Chef',
		next: 'Confirm, edit or swap',
		tone: 'propose'
	};
}

export function buildCases(
	s: WorkspaceState,
	names: Names,
	heldSince: Record<string, string>
): Case[] {
	const out: Case[] = [];
	const pendingLines = new Set<string>();
	for (const a of Object.values(s.approvals))
		if (a.state === 'pending') for (const id of a.lineIds) pendingLines.add(lineKey(a.planId, id));
	for (const plan of Object.values(s.plans))
		for (const l of plan.lines)
			if (lineIsHeld(l))
				out.push(lineCase(plan, l, pendingLines, names, heldSince[lineKey(plan.id, l.id)] ?? null));

	const linked = new Set(out.map((c) => c.planId));
	for (const a of Object.values(s.anomalies)) {
		const plan = a.planId ? s.plans[a.planId] : undefined;
		if (plan && linked.has(plan.id)) continue; // already visible through its held lines
		out.push({
			id: `anomaly:${a.id}`,
			kitchenId: plan?.kitchenId ?? '',
			planId: plan?.id,
			version: plan?.version,
			title: a.message,
			causes: [a.kind.replaceAll('_', ' ')],
			state: 'Detected',
			owner: 'Operations',
			next: 'Check which orders it touches',
			tone: 'blocked',
			deadline: SCENARIO.cutoff,
			since: a.detectedAt
		});
	}

	for (const f of s.failedCommits) {
		const plan = s.plans[f.planId];
		if (!plan || plan.state === 'committed') continue;
		out.push({
			id: `refused:${f.planId}:${f.seq}`,
			kitchenId: plan.kitchenId,
			planId: plan.id,
			version: plan.version,
			title: 'Commit refused',
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
			(a.deadline ?? '9').localeCompare(b.deadline ?? '9') ||
			TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
			(a.since ?? '9').localeCompare(b.since ?? '9')
	);
}

/** Coverage evidence for a kitchen: needs (or lines, for direct orders) that are ordered or orderable. */
export function coverage(
	plans: Plan[]
): { covered: number; total: number; unit: 'needs' | 'lines' } | null {
	let covered = 0;
	let total = 0;
	let unit: 'needs' | 'lines' = 'needs';
	for (const p of plans) {
		const ok = (l: Line) => l.state === 'eligible' || l.state === 'committed';
		if (p.needs.length) {
			total += p.needs.length;
			covered += p.needs.filter((n) => p.lines.some((l) => l.needId === n.id && ok(l))).length;
		} else {
			unit = 'lines';
			total += p.lines.length;
			covered += p.lines.filter(ok).length;
		}
	}
	return total ? { covered, total, unit } : null;
}

/** Where the kitchen shows this case: the exact plan, version and need. */
export function kitchenHref(c: Case): string | null {
	if (!c.planId) return null;
	const q = new URLSearchParams({ kitchen: c.kitchenId, plan: c.planId });
	if (c.version !== undefined) q.set('v', String(c.version));
	if (c.needId) q.set('need', c.needId);
	return `/?${q}`;
}
