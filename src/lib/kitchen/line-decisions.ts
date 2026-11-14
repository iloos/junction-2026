/**
 * Each line's decision, from the plan's live approvals (a split approval keeps a decided line's own): pending (with
 * the approval to decide it on), granted or denied. Lines no approval lists are absent. Pure.
 */
import type { Approval, Line } from '$lib/core/contracts';

export interface LineDecision {
	state: 'pending' | 'granted' | 'denied';
	approval: Approval;
	/** A sign-off line (an allergen change, never delegated): decided one by one, with Confirm exact terms. */
	signOff: boolean;
}

export function lineDecisions(
	lines: readonly Line[],
	approvals: readonly Approval[] | undefined,
	current: Approval | null
): Map<string, LineDecision> {
	const all = approvals?.length ? approvals : current ? [current] : [];
	const tier = new Map(lines.map((l) => [l.id, l.tier]));
	const out = new Map<string, LineDecision>();
	for (const a of all) {
		if (a.state !== 'pending' && a.state !== 'granted' && a.state !== 'denied') continue;
		for (const id of a.lineIds)
			out.set(id, { state: a.state, approval: a, signOff: tier.get(id) === 'sign_off' });
	}
	return out;
}

/** "Accept all": the pending lines that may be accepted together (sign-off lines are decided one by one). */
export function acceptAll(
	lines: readonly Line[],
	decisions: Map<string, LineDecision>
): {
	byApproval: Map<string, { approval: Approval; lineIds: string[] }>;
	count: number;
	cents: number;
	signOff: number;
} {
	const byApproval = new Map<string, { approval: Approval; lineIds: string[] }>();
	let count = 0;
	let cents = 0;
	let signOff = 0;
	for (const l of lines) {
		const d = decisions.get(l.id);
		if (!d || d.state !== 'pending') continue;
		if (d.signOff) {
			signOff++;
			continue;
		}
		const g = byApproval.get(d.approval.id) ?? { approval: d.approval, lineIds: [] };
		g.lineIds.push(l.id);
		byApproval.set(d.approval.id, g);
		count++;
		cents += l.lineCents ?? 0;
	}
	return { byApproval, count, cents, signOff };
}
