import { parseRules } from '$lib/server/request/parse';
import { eventMatches, KITCHEN_RE as KITCHEN, SHORTAGE_RE as SHORTAGE } from './context';
import type { AgentContext, Intent } from './types';

/**
 * Deterministic intent resolver: free-text goal → one supported intent, or `unsupported` with a reason.
 * It runs before any model call, so an unknown request is reported as such instead of being bent into
 * the one seeded event. `clarify` marks an unsupported reading the chef can fix by adding a detail.
 * Routine orders are read by the request parser (quantities, units, dates on the scenario clock);
 * what it cannot read for sure is refused with the reason, never filled in with a default.
 */
export type Resolved = Intent & { clarify?: boolean };

const AUTHORITY =
	/\b(approve|approval|hyväksy\w*|grant)\b|\b(raise|increase|lift|change|set|remove|nosta\w*|muuta\w*|poista\w*)\b.{0,40}\b(cap|caps|limit|limits|mandate|budget|katto\w*|valtuu\w*)\b/i;
const EVENT_WORDS =
	/\b(wedding|häät|birthday|synttär\w*|party|juhla\w*|conference|seminar|banquet|gala|event|tapahtuma\w*|catering|buffet|dinner|lunch for)\b/i;
const INSPECT = /\b(show|status|state|inspect|check|explain|summar\w*|näytä|tilanne|why|what)\b/i;
const ORDER = /\b(order|reorder|buy|tilaa|tilaus)\b/i;
/** "160 g per guest", "0.2 kg/cover", "160 g / hlö". */
const PER_GUEST =
	/(\d+(?:[.,]\d+)?)\s*(g|grams?|kg)\s*(?:per|\/|a|each)\s*(guest|cover|person|head|hlö|henkilö\w*|vieras\w*)/i;
const ADJUST_STOP = new Set(
	'raise increase lower reduce cut change set make bump up down the a an of for to from at in on per please each dish need it we our make serve serving portion portions instead now nosta laske muuta'.split(
		' '
	)
);

/** Largest physical quantity a routine order may ask for; above it the chef uses the request page. */
const MAX_QTY = 100_000;

/** No plan picked: either none is open, or the request does not say which of several. */
function noPlan(c: AgentContext, none: string): Resolved {
	if (c.openPlans.length < 2) return ask(none);
	const list = c.openPlans
		.map((p) => `${p.id} (${p.kitchenId}${p.eventId ? `, ${p.eventId}` : ''})`)
		.join(', ');
	return ask(`Which plan? Name its id, event or kitchen: ${list}.`);
}

/** "4 kg butter tomorrow": no order verb, but an item with a quantity in a stated unit reads as an order. */
function statesAnAmount(goal: string, today: string): boolean {
	const text = goal.replace(/\b(?:for|at|to)\s+k-[a-z]+\b/gi, ' ').replace(KITCHEN, ' ');
	return parseRules(text, today).items.some(
		(i) =>
			i.qty !== null &&
			(i.product !== null || i.search.length > 0) &&
			!i.ambiguities.some((a) => a.startsWith('no unit given'))
	);
}

const ask = (reason: string): Resolved => ({ kind: 'unsupported', reason, clarify: true });

/**
 * A routine order read by the request parser: one item with a quantity in a stated unit (kg, l, pieces,
 * cases or packs) and a delivery date from the goal's own words on the scenario clock. Returns null when
 * the goal names neither a product nor a quantity (then it is not an order request).
 */
function routineOrder(
	goal: string,
	c: AgentContext,
	named: string | undefined,
	kitchens: string[]
): Resolved | null {
	// The kitchen is the run's business, not the product's: drop it (and its "for") before parsing.
	const text = goal.replace(/\b(?:for|at|to)\s+k-[a-z]+\b/gi, ' ').replace(KITCHEN, ' ');
	const parsed = parseRules(text, c.today);
	const items = parsed.items;
	if (!items.some((i) => i.qty !== null || i.product)) return null;

	const kitchenId = named ?? (kitchens.length === 1 ? kitchens[0] : c.defaultKitchenId);
	if (!kitchenId) return ask(`Which kitchen should I order for (${kitchens.join(', ')})?`);
	if (items.length > 1)
		return ask(
			`One product per routine order; I read ${items.length} (${items.map((i) => i.query || i.text).join(', ')}). Order them one at a time.`
		);
	const item = items[0];
	const what = item.query || 'it';
	if (!item.product && !item.search.length) return ask('Which product should I order?');
	if (item.qty === null) return ask(`How much ${what}? Say for example "4 kg ${what}".`);
	if (item.ambiguities.some((a) => a.startsWith('no unit given')))
		return ask(
			`${item.qty} of what unit? Say kg, l, pieces, cases or packs; I will not guess a pack size for ${what}.`
		);
	const comma = item.ambiguities.find((a) => a.includes('comma as thousands'));
	if (comma) return ask(`Unclear quantity: ${comma}. Write it without the comma.`);
	if (!(item.qty > 0 && item.qty <= MAX_QTY) || !item.unit)
		return ask(`Quantity must be above 0 and at most ${MAX_QTY.toLocaleString('en-IE')}.`);
	if (parsed.deliverBySource === 'default' || !parsed.deliverByText)
		return ask(
			`When should ${what} arrive? Say "tomorrow", a weekday or a date (YYYY-MM-DD); I will not pick one.`
		);
	if (parsed.deliverBy < c.today)
		return ask(`"${parsed.deliverByText}" (${parsed.deliverBy}) is in the past.`);

	// What the chef should see about how the words were read; nothing here changes the order.
	const notes = [
		...parsed.ambiguities.filter((a) => a.startsWith(`"${parsed.deliverByText}"`)),
		...parsed.notes,
		...item.ambiguities.filter((a) => a.includes('not in my word list'))
	];
	return {
		kind: 'routine_order',
		kitchenId,
		query: what.slice(0, 60),
		qty: item.qty,
		unit: item.unit,
		item: {
			product: item.product,
			search: item.search,
			constraints: item.constraints,
			variant: item.variant
		},
		deliverBy: parsed.deliverBy,
		deliverByText: parsed.deliverByText,
		notes
	};
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

	// A changed requirement on an existing plan, before any event wording can read it as a new plan.
	const perGuest = goal.match(PER_GUEST);
	if (perGuest) {
		const grams = Number(perGuest[1].replace(',', '.')) * (/^kg/i.test(perGuest[2]) ? 1000 : 1);
		if (!(grams > 0 && grams <= 2000))
			return ask('Grams per guest must be above 0 and at most 2,000.');
		const dish = goal
			.replace(PER_GUEST, ' ')
			.replace(KITCHEN, ' ')
			.toLowerCase()
			.split(/[^\p{L}-]+/u)
			.filter((w) => w.length > 1 && !ADJUST_STOP.has(w))
			.join(' ');
		if (!dish) return ask('Which dish should change?');
		if (!c.currentPlan) return noPlan(c, 'There is no plan to change; plan the event first.');
		return { kind: 'adjust_need', planId: c.currentPlan.id, dish, gramsPerGuest: grams };
	}

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
			return noPlan(c, 'There is no current plan to repair; plan the event first.');
		return { kind: 'shortage_repair', planId: c.currentPlan.id };
	}

	if (ORDER.test(goal) || statesAnAmount(goal, c.today)) {
		const r = routineOrder(goal, c, named, kitchens);
		if (r) return r;
	}

	if (INSPECT.test(goal) || ORDER.test(goal)) {
		if (!c.currentPlan) return noPlan(c, 'There is no plan yet to show.');
		return { kind: 'inspect', planId: c.currentPlan.id };
	}

	return { kind: 'unsupported', reason: `I did not recognise this request. ${supported}` };
}
