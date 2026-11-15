import type { Availability } from '$lib/core/contracts';
import { amountChips } from '$lib/server/chat/half';
import type { ClarifyField } from '$lib/core/contracts/task';
import { onScenario } from '$lib/core/scenario';
import { addDays, findDate, realDate } from '$lib/server/request/dates';
import type { ReqUnit } from '$lib/server/request/lexicon';
import { parseRules } from '$lib/server/request/parse';
import { classifyGoal, perGuestIn } from './classify';
import { eventMatches, KITCHEN_RE as KITCHEN } from './context';
import type { AgentContext, Clarify, Intent, RoutineLine, Slots } from './types';

/**
 * Deterministic intent resolver: free-text goal (+ answered slots) → one supported intent, or `unsupported` with a
 * reason. It runs before any model call, so an unknown request is reported as such instead of being bent into the
 * one seeded event. What the words mean comes from the shared classifier (`classifyGoal`), the same one /request
 * uses. A refusal the chef can fix by giving one detail carries a typed `clarify` {field, question, options}; the
 * answer comes back as a slot and fills that field only, never re-read as words.
 */
export type Resolved = Intent & { clarify?: Clarify };

const ADJUST_STOP = new Set(
	'raise increase lower reduce cut change set make bump up down the a an of for to from at in on per please each dish need it we our make serve serving portion portions instead now nosta laske muuta'.split(
		' '
	)
);

/** Largest physical quantity a routine order may ask for; above it the chef uses the request page. */
const MAX_QTY = 100_000;
const UNITS: readonly ReqUnit[] = ['kg', 'l', 'pcs', 'case', 'sales'];
const UNIT_LABEL: Record<ReqUnit, string> = {
	kg: 'kg',
	l: 'litres',
	pcs: 'pieces',
	case: 'cases',
	sales: 'packs'
};

const ask = (
	field: ClarifyField,
	question: string,
	options: Clarify['options'] = []
): Resolved => ({
	kind: 'unsupported',
	reason: question,
	clarify: { field, question, options: options.slice(0, 6) }
});
const refuse = (reason: string): Resolved => ({ kind: 'unsupported', reason });
/** Finnish words or letters: the refusal answers in the chef's language. */
const FINNISH = /[äöå]|\b(hyväksy\p{L}*|nosta\p{L}*|muuta\p{L}*|se|ne|kaikki|tilaa)\b/iu;

/** Delivery dates to offer: five days from `start` (default tomorrow) on the scenario clock, by weekday. */
function dateOptions(today: string, start = addDays(today, 1)): Clarify['options'] {
	return [0, 1, 2, 3, 4].map((n) => {
		const d = addDays(start, n);
		return {
			// In words ("Thu 10 Dec"), never a date code.
			label: d === addDays(today, 1) ? `Tomorrow, ${dayLabel(d)}` : dayLabel(d),
			value: d
		};
	});
}

/** When ordering closes for a warehouse (Stock) delivery on `deliverBy`, on the scenario's rules (D-1, 17:00). */
export function stockCutoff(deliverBy: string): string {
	return (
		onScenario(
			{
				kind: 'known',
				amount: null,
				logisticModel: 'Stock',
				availableDate: deliverBy,
				closingTime: null,
				raw: null,
				provenance: { source: 'rule' }
			} as unknown as Availability,
			deliverBy
		).closingTime ?? `${deliverBy}T00:00:00Z`
	);
}

/** The first delivery day after `today` whose Stock cut-off is still ahead of `now`. */
export function earliestOpen(today: string, now: string): string {
	let d = addDays(today, 1);
	for (let i = 0; i < 14 && Date.parse(stockCutoff(d)) <= Date.parse(now); i++) d = addDays(d, 1);
	return d;
}

/** "Tue 8 Dec" for a calendar date. */
export const dayLabel = (iso: string) =>
	new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

/** Our words for a passed cut-off: the requested day, when ordering closed, and the earliest day still open. */
export function cutoffPassed(deliverBy: string, closes: string, earliest: string): string {
	const local = new Date(closes);
	const at = local.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Helsinki'
	});
	const on = local.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/Helsinki' });
	return `The cut-off for ${dayLabel(deliverBy)} has passed (${at} ${on}); earliest is ${dayLabel(earliest)}. Which day should it arrive?`;
}

/** Date chips from the first day still open for ordering (the scenario clock's cut-offs), never one already closed. */
const openDates = (c: AgentContext) =>
	dateOptions(c.today, c.now ? earliestOpen(c.today, c.now) : undefined);

/** No plan picked: either none is open, or the request does not say which of several. */
function noPlan(c: AgentContext, none: string): Resolved {
	// No plan open at all: nothing to pick, so say so rather than ask an unanswerable question.
	if (!c.openPlans.length) return refuse(none);
	if (c.openPlans.length < 2) return ask('plan', none);
	// The choices in words (the event and its day, or what the order buys); the id is only the chip's value.
	return ask(
		'plan',
		'Which plan do you mean?',
		c.openPlans
			.slice(0, 6)
			.map((p) => ({ label: (p.name ?? 'An open order').slice(0, 80), value: p.id }))
	);
}

/** The kitchen is the run's business, not the product's: the goal without it (and its "for"). */
export const withoutKitchen = (goal: string) =>
	goal.replace(/\b(?:for|at|to)\s+k-[a-z]+\b/gi, ' ').replace(KITCHEN, ' ');

/** A date slot: an ISO date, or words the parser reads ("tomorrow", "friday"). */
function slotDate(v: string, today: string): { iso: string; text: string } | null {
	if (/^\d{4}-\d{2}-\d{2}$/.test(v) && realDate(v)) return { iso: v, text: v };
	const hit = findDate(v, today);
	return hit && !hit.invalid ? { iso: hit.iso, text: hit.text } : null;
}

/**
 * A routine order read by the request parser: one item with a quantity in a stated unit (kg, l, pieces, cases or
 * packs) and a delivery date from the goal's own words (or the answered slots) on the scenario clock.
 */
function routineOrder(
	goal: string,
	c: AgentContext,
	named: string | undefined,
	kitchens: string[],
	slots: Slots
): Resolved {
	const parsed = parseRules(withoutKitchen(goal), c.today);
	const items = parsed.items;

	const kitchenId = named ?? (kitchens.length === 1 ? kitchens[0] : c.defaultKitchenId);
	if (!kitchenId)
		return ask(
			'kitchen',
			`Which kitchen should I order for (${kitchens.join(', ')})?`,
			c.kitchens.map((k) => ({ label: k.name, value: k.id }))
		);
	// An answered `product` slot names one item (an option is that item's own words, amount included).
	const slot = slots.product ? parseRules(String(slots.product), c.today).items[0] : undefined;
	// Several products, each with its own amount in a stated unit: one order, one line each (up to four).
	const complete = (i: (typeof items)[number]) =>
		i.qty !== null &&
		i.qty > 0 &&
		i.qty <= MAX_QTY &&
		!!i.unit &&
		UNITS.includes(i.unit) &&
		!i.ambiguities.some((a) => a.startsWith('no unit given')) &&
		(!!i.product || i.search.length > 0);
	const several = items.length > 1 && items.length <= 4 && !slot && items.every(complete);
	const more: RoutineLine[] = several
		? items.slice(1).map((i) => ({
				query: (i.query || 'it').slice(0, 60),
				qty: i.qty!,
				unit: i.unit!,
				item: {
					product: i.product,
					search: i.search,
					constraints: i.constraints,
					variant: i.variant,
					text: i.text,
					...(i.diet?.length ? { diet: i.diet } : {}),
					...(i.brand ? { brand: i.brand } : {})
				}
			}))
		: [];
	if (items.length > 1 && !slot && !several)
		return ask(
			'product',
			`One product per routine order; I read ${items.length} (${items.map((i) => i.query || i.text).join(', ')}). Which one first?`,
			items.map((i) => ({ label: i.text.trim(), value: i.text.trim() }))
		);
	let item = several ? items[0] : items.length > 1 || !items[0] ? slot : items[0];
	if (slot && item && item !== slot)
		item = { ...item, product: slot.product, search: slot.search, query: slot.query };
	if (!item || (!item.product && !item.search.length))
		return ask('product', 'Which product should I order?');
	const what = item.query || 'it';
	const qty = slots.qty !== undefined ? Number(slots.qty) : item.qty;
	const unit = (slots.unit as ReqUnit | undefined) ?? item.unit;
	if (qty === null || !Number.isFinite(qty))
		// Never a dead end: three likely amounts as one tap, the product kept.
		return ask(
			'qty',
			`How much ${what}?`,
			amountChips(
				what,
				/milk|cream|maito|kerma|juice|mehu|oil|öljy|drink|juoma/i.test(what) ? 'l' : 'kg'
			)
		);
	const noUnit = item.ambiguities.some((a) => a.startsWith('no unit given'));
	if (slots.unit === undefined && (noUnit || !unit))
		return ask(
			'unit',
			`${qty} of what unit? Say kg, l, pieces, cases or packs; I will not guess a pack size for ${what}.`,
			UNITS.map((u) => ({ label: `${qty} ${UNIT_LABEL[u]}`, value: u }))
		);
	if (!unit || !UNITS.includes(unit))
		return ask(
			'unit',
			`Which unit for ${what}?`,
			UNITS.map((u) => ({ label: UNIT_LABEL[u], value: u }))
		);
	const comma = item.ambiguities.find((a) => a.includes('comma as thousands'));
	if (comma && slots.qty === undefined)
		return ask('qty', `Unclear quantity: ${comma}. How much exactly?`);
	if (!(qty > 0 && qty <= MAX_QTY))
		return ask('qty', `Quantity must be above 0 and at most ${MAX_QTY.toLocaleString('en-IE')}.`);

	let deliverBy = parsed.deliverBy;
	let deliverByText = parsed.deliverByText;
	if (slots.date !== undefined) {
		const d = slotDate(String(slots.date), c.today);
		if (!d) return ask('date', `When should ${what} arrive?`, openDates(c));
		deliverBy = d.iso;
		deliverByText = d.text;
	} else if (parsed.deliverBySource === 'default' || !parsed.deliverByText)
		return ask('date', `When should ${what} arrive?`, openDates(c));
	if (!deliverByText || deliverBy < c.today)
		return ask('date', `"${deliverByText}" (${deliverBy}) is in the past.`, openDates(c));
	// Ordering for that day may already have closed: say so and offer the first day still open, never shift it.
	if (c.now) {
		const closes = stockCutoff(deliverBy);
		if (Date.parse(closes) <= Date.parse(c.now)) {
			const first = earliestOpen(c.today, c.now);
			return ask('date', cutoffPassed(deliverBy, closes, first), dateOptions(c.today, first));
		}
	}

	// What the chef should see about how the words were read; nothing here changes the order.
	const notes =
		slots.date !== undefined
			? []
			: [
					...parsed.ambiguities.filter((a) => a.startsWith(`"${parsed.deliverByText}"`)),
					...parsed.notes,
					...item.ambiguities.filter((a) => a.includes('not in my word list'))
				];
	return {
		kind: 'routine_order',
		kitchenId,
		query: what.slice(0, 60),
		qty,
		unit,
		item: {
			product: item.product,
			search: item.search,
			constraints: item.constraints,
			variant: item.variant,
			text: item.text,
			...(item.diet?.length ? { diet: item.diet } : {}),
			...(item.brand ? { brand: item.brand } : {})
		},
		deliverBy,
		deliverByText,
		notes,
		...(more.length ? { more } : {})
	};
}

/** How many guests the seeded event is for (its own fixture), to tell "the buffet" from another brief. */
const SEEDED_GUESTS: Record<string, number> = { 'event-xmas-140': 140 };

export function resolveIntent(goalRaw: string, c: AgentContext, slots: Slots = {}): Resolved {
	const goal = goalRaw.trim();
	const kitchens = c.kitchens.map((k) => k.id);
	const supported =
		'I can order products ("4 kg butter for Friday"), plan an event menu, change a dish ("cured salmon to 160 g per guest"), find substitutes for what is short, or tell you what is still open.';

	if (!goal) return { kind: 'unsupported', reason: `No goal given. ${supported}` };

	const said = goal.match(KITCHEN)?.[0]?.toLowerCase();
	if (said && !kitchens.includes(said))
		return refuse(
			`${said} is not a kitchen this run may act for (${kitchens.join(', ') || 'none'}).`
		);
	const kitchenSlot = slots.kitchen !== undefined ? String(slots.kitchen) : undefined;
	if (kitchenSlot && !kitchens.includes(kitchenSlot))
		return refuse(`${kitchenSlot} is not a kitchen this run may act for.`);
	const named = kitchenSlot ?? said;

	const cls = classifyGoal(withoutKitchen(goal), c.today);
	switch (cls.kind) {
		case 'authority':
			return refuse(
				FINNISH.test(goal)
					? 'En voi hyväksyä enkä muuttaa valtuutusta: vain kokki hyväksyy, Keittiö-näkymän hyväksyntäkortilla.'
					: "I can't approve or change the mandate: only the chef approves, on the approval card in the Kitchen screen."
			);
		case 'read':
			if (!c.currentPlan) return noPlan(c, 'There is no plan yet to show.');
			return { kind: 'inspect', planId: c.currentPlan.id };
		case 'adjust': {
			// A changed requirement on an existing plan, before any event wording can read it as a new plan.
			const pg = perGuestIn(goal)!;
			if (!(pg.grams > 0 && pg.grams <= 2000))
				return ask('dish', 'Grams per guest must be above 0 and at most 2,000.');
			const dish =
				slots.dish !== undefined
					? String(slots.dish)
					: goal
							.replace(pg.match[0], ' ')
							.replace(KITCHEN, ' ')
							.toLowerCase()
							.split(/[^\p{L}-]+/u)
							.filter((w) => w.length > 1 && !ADJUST_STOP.has(w))
							.join(' ');
			if (!dish) return ask('dish', 'Which dish should change?');
			if (!c.currentPlan) return noPlan(c, 'There is no plan to change; plan the event first.');
			return { kind: 'adjust_need', planId: c.currentPlan.id, dish, gramsPerGuest: pg.grams };
		}
		case 'event': {
			const event = c.supportedEvents.find((e) => eventMatches(goal, e.title, e.id));
			const seededGuests = event ? SEEDED_GUESTS[event.id] : undefined;
			const guests = slots.guests !== undefined ? Number(slots.guests) : cls.event.guests;
			// The seeded event only when the brief is that event: no other guest count, no courses asked for.
			if (event && (guests === null || guests === seededGuests) && cls.event.courses === null) {
				if (named && named !== event.kitchenId)
					return refuse(`${event.title} is seeded for ${event.kitchenId}, not ${named}.`);
				if (!kitchens.includes(event.kitchenId))
					return refuse(
						`${event.title} is for ${event.kitchenId}, which this run may not act for.`
					);
				return { kind: 'seeded_event', kitchenId: event.kitchenId, eventId: event.id };
			}
			const brief = [
				cls.event.occasion,
				guests !== null ? `${guests} guests` : '',
				cls.event.courses !== null ? `${cls.event.courses} courses` : ''
			]
				.filter(Boolean)
				.join(', ');
			return {
				kind: 'unsupported',
				reason:
					`This is an event brief (${brief}). A menu has to be proposed and reviewed by a chef before anything is ordered: ` +
					'describe it in the chat or use New request to get a menu proposal; I will not reuse another event.',
				brief: { occasion: cls.event.occasion, guests, courses: cls.event.courses }
			};
		}
		case 'repair':
			if (!c.currentPlan)
				return noPlan(c, 'There is no current plan to repair; plan the event first.');
			return { kind: 'shortage_repair', planId: c.currentPlan.id };
		case 'order':
			return routineOrder(goal, c, named, kitchens, slots);
		case 'other': {
			// Bare inspect words ("status", "check the plan") read the plan.
			if (/\b(status|state|inspect|check|tilanne)\b/i.test(goal)) {
				if (!c.currentPlan) return noPlan(c, 'There is no plan yet to show.');
				return { kind: 'inspect', planId: c.currentPlan.id };
			}
			return refuse(`I did not recognise this request. ${supported}`);
		}
	}
}
