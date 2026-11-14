/**
 * When something on a plan is due: the earliest binding time among an approval's expiry, the plan view's validity
 * (`validUntil`) and Valio's order cut-off of every open line in question. One rule for the decision card, the
 * calendar, Ops and the agent: an approval valid until 21:40 is still due at a 15:00 cut-off, since past it nothing
 * it approves can be ordered.
 */
import type { Approval, Line, Plan } from '../contracts';

/**
 * The due time (ISO), or null when nothing binds. `lines`: the lines in question (default: the approval's lines, or
 * every open line without an approval). With `now`, times already past are left out: a passed cut-off is a date to
 * change, not a deadline.
 */
export function dueOf(
	plan: Pick<Plan, 'lines' | 'view'> | null | undefined,
	approval?: Pick<Approval, 'expiresAt' | 'lineIds'> | null,
	lines?: readonly Line[],
	now?: Date
): string | null {
	const ids = approval ? new Set(approval.lineIds) : null;
	const inQuestion = lines ?? plan?.lines.filter((l) => (ids ? ids.has(l.id) : true)) ?? [];
	const times = [
		approval?.expiresAt,
		plan?.view?.validUntil,
		...inQuestion
			.filter((l) => l.state !== 'committed' && l.qty.value > 0)
			.map((l) => l.offer?.availability.closingTime)
	]
		.filter((t): t is string => Boolean(t))
		.filter((t) => !now || new Date(t).getTime() > now.getTime());
	if (!times.length) return null;
	return times.reduce((a, b) => (new Date(b).getTime() < new Date(a).getTime() ? b : a));
}
