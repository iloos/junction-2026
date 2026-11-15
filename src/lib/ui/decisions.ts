/**
 * A decision is the unit a human acts on: one reason group of the pending approval (D10: "needs your approval" only
 * where a human can resolve it). The task header, the approval panel, the phone bar and the chat dock all count
 * decisions from here, so the same plan never reads as "7 lines" in one place and "1 decision" in another.
 * Same shape as T1 `TaskPending.decision.groups` ({reason, lineIds, totalCents}) plus what a card shows.
 */
import type { Approval, Line, Plan } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import { dueOf } from '$lib/core/mandate/due';
import { reasonLong, reasonShort } from './reasons';

export interface Decision {
	/** Stable per approval and reason group. */
	key: string;
	/** What approving does, consequence first: "Make lanttulaatikko and joulutorttu in house · allergens change". */
	title: string;
	/** Short reason, e.g. "New product · Allergen change". */
	reason: string;
	/** The reasons in full sentences. */
	why: string;
	lineIds: string[];
	lines: Line[];
	totalCents: number;
	/** Needs a deliberate hold: an allergen change or a broken requirement goes to the named approver's tier. */
	signOff: boolean;
	/** What happens if the chef keeps these held, in our words. */
	consequence: string;
	/** When this decision is due (decisionsDue over its own lines). */
	due: string;
	/** The approval's terms: shown on the card's seal, voided by any edit. */
	approvalId: string;
	planVersion: number;
	termsHash: string;
}

const IGNORED = new Set(['unknown', 'UNKNOWN_REQUIRED']);

/** The open decisions of a pending approval, in the order the approval lists its lines. */
export function decisionsOf(plan: Plan, approval: Approval | null | undefined): Decision[] {
	if (!approval || approval.state !== 'pending') return [];
	const byId = new Map(plan.lines.map((l) => [l.id, l]));
	const needLabel = new Map(plan.needs.map((n) => [n.id, n.label]));
	const groups = new Map<string, { reasons: string[]; lines: Line[]; signOff: boolean }>();
	for (const id of approval.lineIds) {
		const l = byId.get(id);
		if (!l) continue;
		const reasons = l.reasons.filter((r) => !IGNORED.has(r));
		// A swap is its own decision, never lumped with new products for other dishes that share its reasons.
		const swap = !!l.substituteFor && l.strategy?.kind !== 'make_in_house';
		const key = (swap ? 'swap|' : '') + (reasons.map(reasonShort).join(' · ') || 'Held');
		const g = groups.get(key) ?? { reasons, lines: [], signOff: false };
		g.lines.push(l);
		if (l.tier === 'sign_off') g.signOff = true;
		groups.set(key, g);
	}
	return [...groups].map(([group, g]) => {
		const reason = group.replace(/^swap\|/, '');
		const needs = [
			...new Set(g.lines.map((l) => (l.needId ? needLabel.get(l.needId) : undefined)))
		].filter((x): x is string => !!x);
		return {
			key: `${approval.id}:${group}`,
			title: titleOf(g.lines, g.reasons, needLabel),
			reason,
			why: g.reasons.map(reasonLong).join(' '),
			lineIds: g.lines.map((l) => l.id),
			lines: g.lines,
			totalCents: g.lines.reduce((s, l) => s + (l.lineCents ?? 0), 0),
			signOff: g.signOff,
			due: decisionsDue(plan, approval, g.lines),
			consequence: consequenceOf(needs, g.lines.length),
			approvalId: approval.id,
			planVersion: approval.planVersion,
			termsHash: approval.termsHash
		};
	});
}

/** A dish named mid-sentence: Finnish dish names are common nouns ("make lanttulaatikko in house"). */
const dishName = (label: string) => {
	const n = label.split(' (')[0];
	return n[0].toLowerCase() + n.slice(1);
};
const listed = (xs: string[]) =>
	xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A decision named by what approving it does, from its lines: making dishes in house, switching to substitutes,
 * buying new products; an allergen change is said in the title because it is the reason it needs a sign-off.
 */
export function titleOf(
	lines: readonly Line[],
	reasons: readonly string[],
	needLabel: ReadonlyMap<string, string>
): string {
	const dishesOf = (ls: readonly Line[]) => [
		...new Set(
			ls
				.map((l) => (l.needId ? needLabel.get(l.needId) : undefined))
				.filter((x): x is string => !!x)
		)
	];
	const made = lines.filter((l) => l.strategy?.kind === 'make_in_house');
	const swapped = lines.filter((l) => l.strategy?.kind !== 'make_in_house' && l.substituteFor);
	const bought = lines.filter((l) => l.strategy?.kind !== 'make_in_house' && !l.substituteFor);
	const parts: string[] = [];
	if (made.length) {
		const ds = dishesOf(made).map(dishName);
		parts.push(`Make ${ds.length ? listed(ds) : plural(made.length, 'dish', 'dishes')} in house`);
	}
	if (swapped.length) {
		const ds = dishesOf(swapped).map(dishName);
		parts.push(
			ds.length
				? `Use a substitute for ${listed(ds)}`
				: plural(swapped.length, 'substitute', 'substitutes')
		);
	}
	if (bought.length) parts.push(`Buy ${plural(bought.length, 'new product', 'new products')}`);
	if (reasons.includes('allergen_change')) parts.push('allergens change');
	const t = parts.join(' · ');
	return t ? t[0].toUpperCase() + t.slice(1) : 'Approve these lines';
}

function consequenceOf(needs: string[], n: number): string {
	const what = n === 1 ? 'this line is' : `these ${n} lines are`;
	if (!needs.length) return `If you keep them held, ${what} not ordered.`;
	const list =
		needs.length > 3
			? `${needs.slice(0, 3).join(', ')} and ${needs.length - 3} more`
			: needs.join(', ');
	return `If you keep them held, ${what} not ordered and ${list} ${needs.length === 1 ? 'loses' : 'lose'} that cover.`;
}

/**
 * When decisions are due: the earliest binding time among the approval's expiry, the order cut-off of every open
 * line it covers (Valio's closingTime) and the plan view's validity; the scenario's cut-off when none is known. An
 * approval valid until 21:40 is still due at a 15:00 cut-off: past it, nothing it approves can be ordered.
 */
export function decisionsDue(
	plan: Plan | null | undefined,
	approval?: Approval | null,
	lines?: readonly Line[]
): string {
	// One due rule everywhere (core/mandate/due.ts); the scenario's cut-off only when nothing binds.
	return dueOf(plan, approval, lines) ?? SCENARIO.cutoff;
}

/** "2 decisions" / "1 decision" / "No decisions". */
export function decisionCount(n: number): string {
	return n === 0 ? 'No decisions' : n === 1 ? '1 decision' : `${n} decisions`;
}
