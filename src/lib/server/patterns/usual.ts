/**
 * Usual orders, server side (D14): a kitchen's simulated history, the usual order for a delivery day priced
 * through the catalogue port, a compact slice for `get_context`, and "plan this usual order" through the existing
 * `place_order` tool (so the plan goes through the gate, the mandate and `applyOps` like any other order).
 *
 * Read-only apart from `planUsualOrder`, which only calls `place_order`. The history is generated from the
 * kitchen's profile on every read (fixtures/seeds/usual-history.json), labelled "simulated history", and never
 * stored: a pattern is derived from the record and grants nothing.
 */
import recipesJson from '../../../../fixtures/seeds/usual-history.json';
import type { Availability, Kitchen } from '$lib/core/contracts';
import type { CallContext, Catalog, ToolHandlers } from '$lib/core/ports';
import { scenarioDate } from '$lib/core/scenario';
import {
	simulateHistory,
	SIMULATED_HISTORY,
	type HistoryRecipes,
	type SimulatedHistory
} from '$lib/core/patterns/history';
import {
	periodText,
	usualOrder,
	type HistoryWindow,
	type PeriodOverrides,
	type UsualChange,
	type UsualLine,
	type UsualOrder
} from '$lib/core/patterns/usual';
import { nextDeliveryDate } from '$lib/core/patterns/dates';
import { callTool, idempotencyKeyFor } from '$lib/server/request/run';

const recipes = recipesJson as HistoryRecipes;

/** The kitchen's simulated history before `asOf` (exclusive). An unknown profile has none, still labelled. */
export function kitchenHistory(k: Kitchen, asOf: string): SimulatedHistory {
	return simulateHistory(
		recipes,
		{ id: k.id, profile: k.profile, deliveryDays: k.deliveryDays },
		asOf
	);
}

export interface UsualOptions {
	/** The delivery day to fill (YYYY-MM-DD); default the kitchen's next receiving day after today. */
	deliveryDate?: string;
	/** History before this date is read; default the sim's today (Helsinki). */
	asOf?: string;
	window?: HistoryWindow;
	overrides?: PeriodOverrides;
}

/** The usual order (core) for a kitchen and day, over its simulated history. Pure given `asOf`. */
export function usualFor(k: Kitchen, asOf: string, o: Omit<UsualOptions, 'asOf'> = {}): UsualOrder {
	const deliveryDate = o.deliveryDate ?? nextDeliveryDate(asOf, k.deliveryDays);
	return usualOrder({
		lines: kitchenHistory(k, asOf).lines,
		deliveryDate,
		asOf,
		window: o.window,
		deliveryDays: k.deliveryDays,
		overrides: o.overrides
	});
}

export interface PricedUsualLine extends UsualLine {
	/** Catalogue name (short normalised, else Finnish). */
	name: string;
	/** The catalogue's lot step in sales units (an edit keeps whole multiples of it). */
	lotStep: number;
	/** Price per sales unit ex VAT; null when the catalogue has no live price. */
	unitCents: number | null;
	lineCents: number | null;
	/** Live availability for the delivery day; null when no offer came back. */
	availability: Availability['kind'] | null;
	/** "every Tuesday", "every other Wednesday", "monthly, around the 2nd". */
	rhythm: string;
}
export interface NamedChange extends UsualChange {
	name: string;
	rhythm: string;
}

/** What the UI renders: the usual order with names and live prices. */
export interface UsualOrderView extends Omit<
	UsualOrder,
	'lines' | 'joined' | 'dropped' | 'notSettled'
> {
	/** Always "simulated history" until Valio supplies real order history. */
	label: typeof SIMULATED_HISTORY;
	kitchenId: string;
	asOf: string;
	lines: PricedUsualLine[];
	joined: NamedChange[];
	dropped: NamedChange[];
	notSettled: NamedChange[];
	/** Sum of the priced lines, ex VAT. */
	totalCents: number;
	/** Lines without a live price (left out of the total). */
	unpriced: number;
}

/** The usual order for a kitchen and day, named and priced through the catalogue port. Read-only. */
export async function readUsualOrder(
	ports: { catalog: Catalog; clock: { now(): Date } },
	k: Kitchen,
	o: UsualOptions = {}
): Promise<UsualOrderView> {
	const asOf = o.asOf ?? scenarioDate(ports.clock.now());
	const u = usualFor(k, asOf, o);
	const ids = [
		...new Set([...u.lines, ...u.joined, ...u.dropped, ...u.notSettled].map((l) => l.productId))
	];
	const [products, offers] = ids.length
		? await Promise.all([
				ports.catalog.get(ids),
				u.lines.length
					? ports.catalog.offers(
							u.lines.map((l) => l.productId),
							u.deliveryDate
						)
					: Promise.resolve({ offers: [], notFound: [] })
			])
		: [new Map(), { offers: [], notFound: [] }];
	const offer = new Map(offers.offers.map((x) => [x.productId, x]));
	// The catalogue's normalised short name where it has one ("Kevytmaito 1 l laktoositon"), else its Finnish name.
	const name = (id: string) => {
		const p = products.get(id);
		return p ? (p.nameShort?.value ?? p.nameFi) : id;
	};
	const lines: PricedUsualLine[] = u.lines.map((l) => {
		const off = offer.get(l.productId);
		const unitCents = off?.price?.unitCents ?? null;
		return {
			...l,
			name: name(l.productId),
			lotStep: products.get(l.productId)?.lotStep ?? 1,
			unitCents,
			lineCents: unitCents === null ? null : Math.round(unitCents * l.qty),
			availability: off?.availability.kind ?? null,
			rhythm: periodText(l.period)
		};
	});
	const named = (c: UsualChange): NamedChange => ({
		...c,
		name: name(c.productId),
		rhythm: periodText(c.period)
	});
	return {
		...u,
		label: SIMULATED_HISTORY,
		kitchenId: k.id,
		asOf,
		lines,
		joined: u.joined.map(named),
		dropped: u.dropped.map(named),
		notSettled: u.notSettled.map(named),
		totalCents: lines.reduce((n, l) => n + (l.lineCents ?? 0), 0),
		unpriced: lines.filter((l) => l.lineCents === null).length
	};
}

/**
 * The `get_context` slice: the next receiving day's usual order in our own words, without catalogue names or
 * prices (no supplier strings in an agent's context; `quote` prices it).
 */
export interface UsualSlice {
	label: typeof SIMULATED_HISTORY;
	deliveryDate: string;
	sentence: string;
	lines: { productId: string; qty: number; unit: string; score: number; sentence: string }[];
	joined: { productId: string; dueOnDay: boolean; sentence: string }[];
	dropped: { productId: string; sentence: string }[];
}

export function usualSlice(k: Kitchen, asOf: string): UsualSlice {
	const u = usualFor(k, asOf);
	return {
		label: SIMULATED_HISTORY,
		deliveryDate: u.deliveryDate,
		sentence: u.sentence,
		lines: u.lines.map((l) => ({
			productId: l.productId,
			qty: l.qty,
			unit: l.unit,
			score: l.score,
			sentence: l.sentence
		})),
		joined: u.joined.map((c) => ({
			productId: c.productId,
			dueOnDay: c.dueOnDay,
			sentence: c.sentence
		})),
		dropped: u.dropped.map((c) => ({ productId: c.productId, sentence: c.sentence }))
	};
}

export interface PlanUsualInput {
	kitchenId: string;
	deliveryDate: string;
	/** The chef's confirmed lines (the usual lines, edited, plus top-ups). Default: the usual lines as read. */
	lines?: { productId: string; qty: number; unit: string }[];
	/** Makes a second plan of the same lines a distinct plan; the same nonce replays the same plan. */
	nonce?: string;
}

/**
 * "Plan this usual order": the confirmed lines become a plan through `place_order`, the same path /request
 * uses, so the gate, the mandate, approvals and `applyOps` all apply. No other write path.
 */
export async function planUsualOrder(
	handlers: ToolHandlers,
	ctx: CallContext,
	view: Pick<UsualOrderView, 'kitchenId' | 'deliveryDate' | 'lines'>,
	o: Omit<PlanUsualInput, 'kitchenId' | 'deliveryDate'> = {}
) {
	const lines = (o.lines ?? view.lines).map((l) => ({
		productId: l.productId,
		qty: l.qty,
		unit: l.unit
	}));
	if (!lines.length) throw new Error('the usual order has no lines to plan');
	const idempotencyKey = await idempotencyKeyFor(
		view.kitchenId,
		view.deliveryDate,
		lines,
		`usual:${o.nonce ?? ''}`
	);
	return callTool(handlers, ctx, 'place_order', {
		kitchenId: view.kitchenId,
		deliverBy: view.deliveryDate,
		idempotencyKey,
		lines
	});
}
