/**
 * What one change did to a plan, read from the plan before and after (never written into copy): the touched needs
 * (required amount), the touched lines (quantity, added, dropped), the plan total and the decisions left.
 */
import type { Approval, Plan } from '$lib/core/contracts';
import { needUnit } from './coverage';
import { decisionsOf } from './decisions';

export interface PlanDiff {
	from: number;
	to: number;
	needs: { label: string; before: number; after: number; unit: string }[];
	lines: {
		lineId: string;
		name: string;
		before: number | null;
		after: number | null;
		unit: string;
	}[];
	cents: { before: number; after: number };
	decisions: { before: number; after: number };
}

const counted = (p: Plan) =>
	p.lines.filter((l) => l.state !== 'rejected' && l.state !== 'unorderable');
const total = (p: Plan) => counted(p).reduce((s, l) => s + (l.lineCents ?? 0), 0);

export function planDiff(
	a: { plan: Plan; approval: Approval | null },
	b: { plan: Plan; approval: Approval | null }
): PlanDiff | null {
	if (a.plan.id !== b.plan.id || b.plan.version <= a.plan.version) return null;
	const req = (p: Plan) => new Map((p.view?.fulfilment ?? []).map((f) => [f.needId, f]));
	const ra = req(a.plan);
	const needs = [...req(b.plan)].flatMap(([id, f]) => {
		const o = ra.get(id);
		return o && Math.abs(o.required.value - f.required.value) > 1e-9
			? [
					{
						label: f.label,
						before: o.required.value,
						after: f.required.value,
						unit: needUnit(f)
					}
				]
			: [];
	});
	const la = new Map(counted(a.plan).map((l) => [l.id, l]));
	const lb = new Map(counted(b.plan).map((l) => [l.id, l]));
	const name = (l: Plan['lines'][number]) => l.productName ?? l.productId;
	const lines: PlanDiff['lines'] = [];
	for (const [id, l] of lb) {
		const o = la.get(id);
		if (!o)
			lines.push({ lineId: id, name: name(l), before: null, after: l.qty.value, unit: l.qty.unit });
		else if (o.qty.value !== l.qty.value)
			lines.push({
				lineId: id,
				name: name(l),
				before: o.qty.value,
				after: l.qty.value,
				unit: l.qty.unit
			});
	}
	// A touched need's lines that kept their quantity still say so: the packs are part of the answer.
	const touched = new Set(
		[...req(b.plan)]
			.filter(([id, f]) => {
				const o = ra.get(id);
				return o && Math.abs(o.required.value - f.required.value) > 1e-9;
			})
			.map(([id]) => id)
	);
	for (const [id, l] of lb)
		if (l.needId && touched.has(l.needId) && la.get(id)?.qty.value === l.qty.value)
			lines.push({
				lineId: id,
				name: name(l),
				before: l.qty.value,
				after: l.qty.value,
				unit: l.qty.unit
			});
	for (const [id, o] of la)
		if (!lb.has(id))
			lines.push({ lineId: id, name: name(o), before: o.qty.value, after: null, unit: o.qty.unit });
	const cents = { before: total(a.plan), after: total(b.plan) };
	const decisions = {
		before: decisionsOf(a.plan, a.approval).length,
		after: decisionsOf(b.plan, b.approval).length
	};
	if (!needs.length && !lines.length && cents.before === cents.after) return null;
	return { from: a.plan.version, to: b.plan.version, needs, lines, cents, decisions };
}
