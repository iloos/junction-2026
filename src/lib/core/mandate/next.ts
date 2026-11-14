/**
 * The one rule for what a plan needs next (get_context, the agent's outcome, the task ledger and /request all read
 * it). Derived from the line views, which already hold as of now (cut-offs, expired grants), and the plan's
 * fulfilment; never from a model. In order:
 *   change_date      a line is closed only because its cut-off passed: a substitute would not fix that, a later date does
 *   find_substitute  a line nothing can buy (out, undeliverable, recalled, denied)
 *   resolve_rule     a fact gap or a rule a human must settle (price missing, unit, qty implausible)
 *   resolve_need     a need with no line that can cover it (an unresolved menu ingredient, an uncovered amount)
 *   approve          held lines waiting for a person
 *   commit           lines that may be ordered now
 *   wait_for_supplier committed lines the supplier has not confirmed
 *   done
 * `deadline` is the earliest cut-off among lines still to approve or commit: the time the text says to act before.
 */
import type { Line, Plan } from '../contracts';
import { earliestDelivery, LEAD_DAYS, SCENARIO } from '../scenario';

export type NextActionKind =
	| 'change_date'
	| 'find_substitute'
	| 'resolve_rule'
	| 'resolve_need'
	| 'approve'
	| 'commit'
	| 'wait_for_supplier'
	| 'done';

export interface NextAction {
	action: NextActionKind;
	lineIds: string[];
	needIds?: string[];
	/** change_date: the first delivery date every closed line can still be ordered for. */
	earliestDate?: string;
	/** Earliest binding cut-off among lines to approve or commit (ISO). */
	deadline?: string;
	/** Plain words with counts, e.g. "2 lines need an approval before Tue 15:00". */
	text: string;
}

/** Reasons that close a line whatever the date: a later delivery would not reopen it. */
const CLOSED_ANYWAY = new Set(['out', 'undeliverable', 'blocked', 'recall', 'NOT_FOUND']);

const tz = { timeZone: SCENARIO.timeZone } as const;
/** "Wed 9 Dec" for a calendar date. */
export function dayText(date: string): string {
	return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
		...tz,
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
}
/** "Tue 15:00" for an instant, in Helsinki time. */
export function timeText(iso: string): string {
	const d = new Date(iso);
	const day = d.toLocaleDateString('en-GB', { ...tz, weekday: 'short' });
	const time = d.toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' });
	return `${day} ${time}`;
}

const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
const open = (l: Line) => l.state !== 'committed' && l.qty.value > 0;
const codes = (l: Line) => [
	...l.reasons,
	...(l.view?.blockedReason ? [l.view.blockedReason.code] : [])
];

function closedByCutoff(l: Line): boolean {
	const c = codes(l);
	return c.includes('cutoff_passed') && !c.some((r) => CLOSED_ANYWAY.has(r));
}

export function nextActionFor(plan: Plan, now: Date): NextAction {
	const live = plan.lines.filter(open);
	const actNow = live.filter(
		(l) => l.view?.nextAction === 'approve' || l.view?.nextAction === 'commit'
	);
	const deadline = actNow
		.map((l) => l.offer?.availability.closingTime)
		.filter((c): c is string => Boolean(c) && new Date(c!).getTime() > now.getTime())
		.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
	const before = deadline ? ` before ${timeText(deadline)}` : '';
	const withDeadline = (a: Omit<NextAction, 'deadline'>): NextAction =>
		deadline ? { ...a, deadline } : a;

	const late = live.filter(closedByCutoff);
	if (late.length) {
		const earliestDate = late
			.map((l) =>
				earliestDelivery(
					now,
					l.offer?.availability.logisticModel as keyof typeof LEAD_DAYS | null,
					l.offer?.availability.closingTime?.slice(11, 19) || undefined
				)
			)
			.sort()
			.at(-1)!;
		const closed = late
			.map((l) => l.offer?.availability.closingTime)
			.filter((c): c is string => Boolean(c))
			.sort()[0];
		return withDeadline({
			action: 'change_date',
			lineIds: late.map((l) => l.id),
			earliestDate,
			text: `The cut-off for ${dayText(plan.deliverBy)} has passed${closed ? ` (${timeText(closed)})` : ''} for ${lines(late.length)}; earliest delivery is ${dayText(earliestDate)}`
		});
	}

	const by = (a: NonNullable<Line['view']>['nextAction']) =>
		live.filter((l) => l.view?.nextAction === a).map((l) => l.id);

	const subs = by('find_substitute');
	if (subs.length)
		return withDeadline({
			action: 'find_substitute',
			lineIds: subs,
			text: `${lines(subs.length)} can't be bought as planned: find a substitute`
		});

	const rules = [...by('resolve_rule'), ...by('requote')];
	if (rules.length)
		return withDeadline({
			action: 'resolve_rule',
			lineIds: rules,
			text: `${lines(rules.length)} need a missing fact or a rule settled before they can be ordered`
		});

	const fulfilment = plan.view?.fulfilment ?? [];
	const short = plan.needs.filter((n) => {
		if (n.unresolved) return true;
		const f = fulfilment.find((x) => x.needId === n.id);
		return f
			? f.status === 'uncovered' || f.status === 'partial'
			: !plan.lines.some((l) => l.needId === n.id);
	});
	if (short.length)
		return withDeadline({
			action: 'resolve_need',
			lineIds: [],
			needIds: short.map((n) => n.id),
			text: `${short.length} need${short.length === 1 ? '' : 's'} not covered yet: ${short
				.slice(0, 3)
				.map((n) => n.label)
				.join(', ')}${short.length > 3 ? ', …' : ''}`
		});

	const approve = by('approve');
	if (approve.length)
		return withDeadline({
			action: 'approve',
			lineIds: approve,
			text: `${lines(approve.length)} need${approve.length === 1 ? 's' : ''} an approval${before}`
		});

	const commit = by('commit');
	if (commit.length)
		return withDeadline({
			action: 'commit',
			lineIds: commit,
			text: `${lines(commit.length)} can be ordered now${before}`
		});

	const waiting = plan.lines.filter(
		(l) => l.state === 'committed' && l.view?.nextAction === 'wait_for_supplier'
	);
	if (waiting.length)
		return {
			action: 'wait_for_supplier',
			lineIds: waiting.map((l) => l.id),
			text: `Ordered; waiting for the supplier to confirm ${lines(waiting.length)}`
		};

	return { action: 'done', lineIds: [], text: 'Nothing left to do on this plan' };
}
