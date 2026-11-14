/**
 * A kitchen's basket: every open plan of one kitchen merged per delivery day (the event plan, usual orders,
 * /request and chat orders, outside agents' orders), each line with where it came from and where it stands. Pure
 * and read-only: approving and ordering stay per plan through the existing commands; the basket only groups them.
 * Built from the order stages (stages.ts), so Ops and the Kitchen read one projection.
 */
import type { ActorKind, SalesQty } from '../contracts';
import { isoWeek } from '../mandate/tier';
import { dueOf } from '../mandate/due';
import type { OrderStages, Origin } from './stages';

/**
 * Where a line stands. `proposed`: planned and orderable within the mandate, not yet ordered. `held`: waits on a
 * person's decision. `approved`: a person signed it, not yet ordered. `ordered`: committed.
 */
export type BasketStage = 'proposed' | 'held' | 'approved' | 'ordered';

/** One plan contributing to a day, in words. */
export interface BasketSource {
	planId: string;
	/** event, usual, request, chat, outside_agent or kitchen. */
	kind: Origin;
	/** "Wednesday lunch buffet, 320 covers", "3 cases Valio milk", or "Order by line". */
	title: string;
	/** The same, short enough for a chip (24 characters at most): "Usual order", "Event", "From chat". */
	label: string;
	startedBy: ActorKind;
	version: number;
	/** The pending approval a decision on this plan's held lines goes to (approve stays per plan). */
	approvalId: string | null;
}

export interface BasketLine {
	planId: string;
	lineId: string;
	productId: string;
	productName: string;
	qty: SalesQty;
	unitCents: number | null;
	lineCents: number | null;
	stage: BasketStage;
	/** Typed LineReasons (why it is held, or what the agent noted). */
	reasons: string[];
	/** The dish or need it serves, in words, when the plan has needs. */
	need?: string;
	/** The product it replaces, when it is a substitute. */
	substituteFor?: string;
	/** Valio's order cut-off for this line, when quoted. */
	cutoff: string | null;
}

export interface BasketDay {
	/** Delivery date, YYYY-MM-DD. */
	date: string;
	sources: BasketSource[];
	lines: BasketLine[];
	/** Euros by stage, and all of them. */
	totals: Record<BasketStage, number> & { all: number };
	/** The kitchen's week budget (the ISO week of this day, as the commit's lock counts it). */
	budget: {
		week: string;
		capCents: number | null;
		/** Ordered for any day of this week, before this basket's open lines. */
		orderedCents: number;
		/** What ordering everything still open on this day would bring the week to. */
		ifAllOrderedCents: number;
	};
	/** When this day must be decided: dueOf over its open lines (approval expiry, view validity, cut-offs). */
	due: string | null;
	counts: {
		/** Lines that can be ordered now: proposed within the mandate, or approved. */
		orderableNow: number;
		/** Lines waiting on a person. */
		waitingOnDecision: number;
		/** Plans with a pending approval. */
		decisions: number;
		/** Lines that can't be ordered at all (shown in their plan, not in the basket). */
		cannotOrder: number;
	};
	/** Their product names, so the day can say which. */
	cannotOrderNames: string[];
}

export interface Basket {
	kitchenId: string;
	days: BasketDay[];
}

export interface BasketOptions {
	/** Only this delivery day. */
	date?: string;
	/** Only days on or after this one (the scenario's today), when no Sat Nov 14 19:15:14 FLEST 2026 is given. */
	from?: string;
	/** The kitchen's weekly cap (mandate.weeklyCapCents), when it has one. */
	weeklyCapCents?: number | null;
	/** A plan's title in words; the route passes its own (event names, amounts in sales units). */
	title?: (s: OrderStages) => string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A plain title when the caller has none: the needs, or the products, by count. */
function fallbackTitle(s: OrderStages): string {
	if (s.asked.needs.length) return plural(s.asked.needs.length, 'dish', 'dishes');
	if (s.asked.lines.length) return plural(s.asked.lines.length, 'product');
	return 'An order still being drafted';
}

const DEAD = new Set(['unorderable', 'rejected']);

const LABEL: Record<Origin, string> = {
	event: 'Event',
	usual: 'Usual order',
	request: 'From a request',
	chat: 'From chat',
	outside_agent: 'Outside agent',
	menu: 'From a menu',
	kitchen: 'Kitchen order'
};

export function basketFor(stages: OrderStages[], kitchenId: string, o: BasketOptions = {}): Basket {
	const mine = stages.filter((s) => s.kitchenId === kitchenId);
	// Ordered euros per budget week, across every plan of the kitchen (the commit's lock counts by week).
	const orderedByWeek = new Map<string, number>();
	for (const s of mine)
		for (const ord of s.ordered)
			orderedByWeek.set(
				isoWeek(s.deliverBy),
				(orderedByWeek.get(isoWeek(s.deliverBy)) ?? 0) + ord.totalCents
			);

	const byDay = new Map<string, OrderStages[]>();
	for (const s of mine)
		if (o.date ? s.deliverBy === o.date : !o.from || s.deliverBy >= o.from)
			byDay.set(s.deliverBy, [...(byDay.get(s.deliverBy) ?? []), s]);

	const days = [...byDay.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, plans]): BasketDay => {
			const lines: BasketLine[] = [];
			const sources: BasketSource[] = [];
			const cannotOrderNames: string[] = [];
			let due: string | null = null;
			for (const s of plans) {
				const granted = new Set(
					s.signed.filter((a) => a.state === 'granted').flatMap((a) => a.lineIds)
				);
				const needLabel = new Map(s.plan.needs.map((n) => [n.id, n.label]));
				const names = new Map(s.plan.lines.map((l) => [l.productId, l.productName ?? l.productId]));
				sources.push({
					planId: s.planId,
					kind: s.origin,
					title: (o.title ?? fallbackTitle)(s),
					label: LABEL[s.origin],
					startedBy: s.createdBy,
					version: s.version,
					approvalId: s.pending?.id ?? null
				});
				const open = [];
				for (const l of s.plan.lines) {
					if (DEAD.has(l.state)) {
						cannotOrderNames.push(l.productName ?? `Product ${l.productId}`);
						continue;
					}
					if (l.qty.value <= 0) continue; // superseded: kept at 0 in its plan, not bought
					const stage: BasketStage =
						l.state === 'committed'
							? 'ordered'
							: l.state === 'held'
								? granted.has(l.id)
									? 'approved'
									: 'held'
								: 'proposed';
					if (stage !== 'ordered') open.push(l);
					lines.push({
						planId: s.planId,
						lineId: l.id,
						productId: l.productId,
						productName: l.productName ?? `Product ${l.productId}`,
						qty: l.qty,
						unitCents: l.offer?.price?.unitCents ?? null,
						lineCents: l.lineCents,
						stage,
						reasons: l.reasons.map(String),
						...(l.needId && needLabel.get(l.needId) ? { need: needLabel.get(l.needId) } : {}),
						...(l.substituteFor
							? { substituteFor: names.get(l.substituteFor) ?? `Product ${l.substituteFor}` }
							: {}),
						cutoff: l.offer?.availability.closingTime ?? null
					});
				}
				const d = open.length ? dueOf(s.plan, s.pending, open) : null;
				if (d && (!due || new Date(d) < new Date(due))) due = d;
			}
			const totals = { proposed: 0, held: 0, approved: 0, ordered: 0, all: 0 };
			for (const l of lines) {
				totals[l.stage] += l.lineCents ?? 0;
				totals.all += l.lineCents ?? 0;
			}
			const week = isoWeek(date);
			const orderedCents = orderedByWeek.get(week) ?? 0;
			return {
				date,
				sources,
				lines,
				totals,
				budget: {
					week,
					capCents: o.weeklyCapCents ?? null,
					orderedCents,
					ifAllOrderedCents: orderedCents + totals.proposed + totals.held + totals.approved
				},
				due,
				counts: {
					orderableNow: lines.filter((l) => l.stage === 'proposed' || l.stage === 'approved')
						.length,
					waitingOnDecision: lines.filter((l) => l.stage === 'held').length,
					decisions: sources.filter((x) => x.approvalId).length,
					cannotOrder: cannotOrderNames.length
				},
				cannotOrderNames
			};
		});
	// A day with nothing live (every line ordered elsewhere or dead) still shows when it has orders: drop only empty ones.
	return { kitchenId, days: days.filter((d) => d.lines.length) };
}
