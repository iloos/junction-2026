import type { AgentContext, Intent } from './types';

/**
 * Deterministic intent resolver: free-text goal → one supported intent, or `unsupported` with a reason.
 * It runs before any model call, so an unknown request is reported as such instead of being bent into
 * the one seeded event. `clarify` marks an unsupported reading the chef can fix by adding a detail.
 */
export type Resolved = Intent & { clarify?: boolean };

const AUTHORITY =
	/\b(approve|approval|hyväksy\w*|grant)\b|\b(raise|increase|lift|change|set|remove|nosta\w*|muuta\w*|poista\w*)\b.{0,40}\b(cap|caps|limit|limits|mandate|budget|katto\w*|valtuu\w*)\b/i;
const EVENT_WORDS =
	/\b(wedding|häät|birthday|synttär\w*|party|juhla\w*|conference|seminar|banquet|gala|event|tapahtuma\w*|catering|buffet|dinner|lunch for)\b/i;
const SHORTAGE =
	/\b(shortage|short|out of stock|outage|outages|unavailable|substitut\w*|replace\w*|rescue|repair|loppu\w*|puuttu\w*|korvaa\w*)\b/i;
const INSPECT = /\b(show|status|state|inspect|check|explain|summar\w*|näytä|tilanne|why|what)\b/i;
const ORDER = /\b(order|reorder|buy|tilaa|tilaus)\b/i;
const QTY = /(?<![\w-])(\d+(?:[.,]\d+)?)(?![\w-])/;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const KITCHEN = /\bk-[a-z]+\b/i;
const STOP = new Set(
	'order reorder buy tilaa tilaus please for of the a an by to at in kg g l kpl pcs pack packs unit units x and me some us our more new deliver delivery tomorrow'.split(
		' '
	)
);

/** Words of an event title that identify it in a goal ("Christmas buffet for 140" → christmas, xmas, joulu). */
function eventMatches(goal: string, title: string, id: string): boolean {
	const g = goal.toLowerCase();
	if (g.includes(id)) return true;
	if (/christmas|joulu/i.test(title) && /\b(christmas|xmas|joulu\w*|pikkujoulu\w*)\b/i.test(g))
		return true;
	return false;
}

function addDays(isoDate: string, days: number): string {
	const d = new Date(`${isoDate}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export function resolveIntent(goalRaw: string, c: AgentContext): Resolved {
	const goal = goalRaw.trim();
	const kitchens = c.kitchens.map((k) => k.id);
	const supported =
		'I can plan a seeded event (' +
		(c.supportedEvents.map((e) => `${e.title} at ${e.kitchenId}`).join(', ') || 'none seeded') +
		'), repair shortages in the current plan, place a routine order ("order 4 maito for k-lounas"), or show the current plan.';

	if (!goal) return { kind: 'unsupported', reason: `No goal given. ${supported}`, clarify: true };
	if (AUTHORITY.test(goal))
		return {
			kind: 'unsupported',
			reason:
				'Approving and changing the mandate belong to the chef; the agent never does either. Use the approval card or the mandate screen.'
		};

	const named = goal.match(KITCHEN)?.[0]?.toLowerCase();
	if (named && !kitchens.includes(named))
		return {
			kind: 'unsupported',
			reason: `${named} is not a kitchen this run may act for (${kitchens.join(', ') || 'none'}).`
		};

	const event = c.supportedEvents.find((e) => eventMatches(goal, e.title, e.id));
	if (event) {
		if (named && named !== event.kitchenId)
			return {
				kind: 'unsupported',
				reason: `${event.title} is seeded for ${event.kitchenId}, not ${named}.`
			};
		if (!kitchens.includes(event.kitchenId))
			return {
				kind: 'unsupported',
				reason: `${event.title} is for ${event.kitchenId}, which this run may not act for.`
			};
		return { kind: 'seeded_event', kitchenId: event.kitchenId, eventId: event.id };
	}
	if (EVENT_WORDS.test(goal))
		return {
			kind: 'unsupported',
			reason: `No seeded event matches this request; I will not substitute another event. ${supported}`
		};

	if (SHORTAGE.test(goal)) {
		if (!c.currentPlan)
			return {
				kind: 'unsupported',
				reason: 'There is no current plan to repair; plan the event first.',
				clarify: true
			};
		return { kind: 'shortage_repair', planId: c.currentPlan.id };
	}

	const qty = goal.match(QTY);
	if (ORDER.test(goal) && qty) {
		const kitchenId = named ?? (kitchens.length === 1 ? kitchens[0] : undefined);
		if (!kitchenId)
			return {
				kind: 'unsupported',
				reason: `Which kitchen should I order for (${kitchens.join(', ')})?`,
				clarify: true
			};
		const n = Number(qty[1].replace(',', '.'));
		if (!(n > 0 && n <= 1000))
			return {
				kind: 'unsupported',
				reason: 'Quantity must be between 0 and 1000 sales units.',
				clarify: true
			};
		const words = goal
			.replace(KITCHEN, ' ')
			.replace(DATE, ' ')
			.replace(QTY, ' ')
			.toLowerCase()
			.split(/[^\p{L}\p{N}%-]+/u)
			.filter((w) => w && !STOP.has(w));
		if (!words.length)
			return { kind: 'unsupported', reason: 'Which product should I order?', clarify: true };
		return {
			kind: 'routine_order',
			kitchenId,
			query: words.join(' ').slice(0, 60),
			qty: n,
			deliverBy: goal.match(DATE)?.[0] ?? addDays(c.today, 2)
		};
	}

	if (INSPECT.test(goal) || ORDER.test(goal)) {
		if (!c.currentPlan)
			return { kind: 'unsupported', reason: 'There is no plan yet to show.', clarify: true };
		return { kind: 'inspect', planId: c.currentPlan.id };
	}

	return { kind: 'unsupported', reason: `I did not recognise this request. ${supported}` };
}
