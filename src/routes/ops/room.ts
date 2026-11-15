/**
 * The room (D24): every store in one workspace, the orders as they land, and what a shortage did to each store.
 * Pure: reads the kitchens the page loaded, the sim events the stream received and the reduced state.
 * Stores and shortages arrive as sim events ('kitchen.created', 'shortage.replanned'); their details are typed here.
 */
import type { Order } from '$lib/core/contracts';
import type { SimEvent } from '$lib/core/contracts/events';

export type OpsKitchen = {
	id: string;
	name: string;
	kind: string;
	city: string;
	mandateWords: string;
	weeklyCapCents: number;
	/** The seeded profile a visitor's store was copied from; absent on seeded kitchens and blank stores. */
	copiedFrom?: string;
	/** A store a visitor made in the room (create_kitchen), copied from a sample or blank; false for the samples. */
	visitor?: boolean;
};

export interface StoreCreated {
	kitchenId: string;
	name: string;
	kind: string;
	city: string;
	copiedFrom: string;
	mandateWords: string;
	weeklyCapCents: number;
	createdAt: string;
}

export type ShortageOutcome = 'unaffected' | 'kept' | 'swapped' | 'held' | 'short';
type Amount = { qty: number; unit: string } | null;

export interface ShortageKitchen {
	kitchenId: string;
	kitchenName: string;
	planId: string | null;
	outcome: ShortageOutcome;
	changed: { lineId: string; productId: string; productName: string; was: Amount; now: Amount }[];
	swaps: {
		fromProductId: string;
		fromName: string;
		toProductId: string;
		toName: string;
		qty: number;
		unit: string;
	}[];
	allowedBy: string;
	waitsForPerson: number;
	why: string;
}

export interface ShortageReplanned {
	shortageId: string;
	productId: string;
	productName: string;
	had: number;
	left: number;
	unit: string;
	kitchens: ShortageKitchen[];
}

type Sim = { seq: number; event: Pick<SimEvent, 'detail'> & { kind: string; label?: string } };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A kitchen.created detail, or null when it lacks the fields a store needs to be shown. */
export function storeOf(detail: Record<string, unknown>): StoreCreated | null {
	const kitchenId = str(detail.kitchenId);
	const name = str(detail.name);
	if (!kitchenId || !name) return null;
	return {
		kitchenId,
		name,
		kind: str(detail.kind),
		city: str(detail.city),
		copiedFrom: str(detail.copiedFrom),
		mandateWords: str(detail.mandateWords),
		weeklyCapCents: num(detail.weeklyCapCents),
		createdAt: str(detail.createdAt)
	};
}

/** The stores created in this room, oldest first, each once (a replayed event doesn't add it twice). */
export function storesCreated(sims: readonly Sim[]): StoreCreated[] {
	const out = new Map<string, StoreCreated>();
	for (const s of [...sims].sort((a, b) => a.seq - b.seq)) {
		if (s.event.kind !== 'kitchen.created') continue;
		const k = storeOf(s.event.detail);
		if (k && !out.has(k.kitchenId)) out.set(k.kitchenId, k);
	}
	return [...out.values()];
}

/** The kitchens the page loaded plus any store created since, in arrival order after the loaded ones. */
export function roomKitchens(loaded: readonly OpsKitchen[], created: readonly StoreCreated[]) {
	const have = new Set(loaded.map((k) => k.id));
	const added: OpsKitchen[] = created
		.filter((c) => !have.has(c.kitchenId))
		.map((c) => ({
			id: c.kitchenId,
			name: c.name,
			kind: c.kind,
			city: c.city,
			mandateWords: c.mandateWords,
			weeklyCapCents: c.weeklyCapCents,
			copiedFrom: c.copiedFrom || undefined,
			visitor: true
		}));
	return [...loaded, ...added];
}

/** A shortage notice's detail as a ShortageReplanned (fields checked). */
function shortageOf(d: Record<string, unknown>): ShortageReplanned {
	const kitchens = Array.isArray(d.kitchens) ? (d.kitchens as ShortageKitchen[]) : [];
	return {
		shortageId: str(d.shortageId),
		productId: str(d.productId),
		productName: str(d.productName),
		had: num(d.had),
		left: num(d.left),
		unit: str(d.unit),
		kitchens: kitchens.filter((k) => k && typeof k.kitchenId === 'string')
	};
}

/** The newest shortage re-plan in the room, or null. */
export function lastShortage(sims: readonly Sim[]): ShortageReplanned | null {
	let best: Sim | null = null;
	for (const s of sims)
		if (s.event.kind === 'shortage.replanned' && (!best || s.seq > best.seq)) best = s;
	return best ? shortageOf(best.event.detail) : null;
}

/**
 * The newest incident (a run of shortage notices with the same "Simulated incident: …" label), its products in the
 * order they re-planned; null when the newest shortage wasn't an incident.
 */
export function lastIncident(
	sims: readonly Sim[],
	prefix: string
): { label: string; shortages: ShortageReplanned[] } | null {
	const list = sims
		.filter((s) => s.event.kind === 'shortage.replanned')
		.sort((a, b) => a.seq - b.seq);
	const last = list[list.length - 1];
	const label = last?.event.label;
	if (!label || !label.startsWith(prefix)) return null;
	const run: Sim[] = [];
	for (let i = list.length - 1; i >= 0 && list[i].event.label === label; i--) run.unshift(list[i]);
	return { label, shortages: run.map((s) => shortageOf(s.event.detail)) };
}

/** Counts per outcome, for the one sentence over the shortage table. */
export function shortageCounts(s: ShortageReplanned): Record<ShortageOutcome, number> {
	const c: Record<ShortageOutcome, number> = {
		unaffected: 0,
		kept: 0,
		swapped: 0,
		held: 0,
		short: 0
	};
	for (const k of s.kitchens) if (k.outcome in c) c[k.outcome] += 1;
	return c;
}

export interface FeedOrder {
	id: string;
	kitchenId: string;
	kitchenName: string;
	lines: number;
	totalCents: number;
	committedAt: string;
	deliverBy: string;
}

/** Orders newest first, named by store. */
export function orderFeed(
	orders: Record<string, Order>,
	kitchenName: (id: string) => string,
	limit = 20
): FeedOrder[] {
	return Object.values(orders)
		.sort((a, b) => b.committedAt.localeCompare(a.committedAt) || b.id.localeCompare(a.id))
		.slice(0, limit)
		.map((o) => ({
			id: o.id,
			kitchenId: o.kitchenId,
			kitchenName: kitchenName(o.kitchenId),
			lines: o.lines.length,
			totalCents: o.totalCents,
			committedAt: o.committedAt,
			deliverBy: o.deliverBy
		}));
}

/** Per store: orders placed and their total, for the store grid. */
export function storeTotals(
	orders: Record<string, Order>
): Record<string, { n: number; cents: number }> {
	const out: Record<string, { n: number; cents: number }> = {};
	for (const o of Object.values(orders)) {
		const t = (out[o.kitchenId] ??= { n: 0, cents: 0 });
		t.n += 1;
		t.cents += o.totalCents;
	}
	return out;
}

/** Seed kitchen kinds in words (VOCABULARY: a store's type, never the code). */
export const KIND_WORDS: Record<string, string> = {
	city_hotel: 'City hotel',
	lunch_restaurant: 'Lunch restaurant',
	public_central_kitchen: 'Central kitchen',
	a_la_carte_restaurant: 'À la carte restaurant',
	care_home_kitchen: 'Care home kitchen',
	cafe: 'Café',
	ski_resort_hotel: 'Ski resort hotel'
};
export const kindWords = (kind: string) =>
	KIND_WORDS[kind] ?? kind.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

/** What a shortage did to one store, in a word. */
export const OUTCOME_WORDS: Record<ShortageOutcome, string> = {
	unaffected: 'Not affected',
	kept: 'Kept, enough left',
	swapped: 'Swapped',
	held: 'Waits for a person',
	short: 'Still short'
};

/** The one sentence over the shortage table. */
export function shortageSentence(s: ShortageReplanned): string {
	const c = shortageCounts(s);
	const parts = [
		c.swapped && `${c.swapped} swapped within their rules`,
		c.kept && `${c.kept} kept their order`,
		c.held && `${c.held} wait${c.held === 1 ? 's' : ''} for a person`,
		c.short && `${c.short} still short`,
		c.unaffected && `${c.unaffected} not affected`
	].filter(Boolean);
	const stores = s.kitchens.length;
	// A sales-unit code (KI, PS) is not a word: show the counts alone.
	const unit = /^[A-Z]{1,3}$/.test(s.unit) ? '' : ` ${s.unit}`;
	return `${s.productName}: ${s.had} → ${s.left}${unit} left. ${stores} store${stores === 1 ? '' : 's'} re-planned: ${parts.join(', ') || 'no changes'}.`;
}

/** A visitor's store: flagged, copied from a sample, or with create_kitchen's `k-v-` id (a blank store has no sample). */
export const isVisitorStore = (k: OpsKitchen) =>
	!!k.visitor || !!k.copiedFrom || k.id.startsWith('k-v-');

/**
 * The store list for the big screen: stores made in the room first (newest on top), then any with orders (largest
 * total first), then the seeded sample kitchens in their own order. `samples` are the quiet seeded ones, for
 * collapsing past a few.
 */
export function roomOrder(
	kitchens: readonly OpsKitchen[],
	totals: Record<string, { n: number; cents: number }>
): { active: OpsKitchen[]; samples: OpsKitchen[] } {
	const made = kitchens.filter(isVisitorStore).reverse();
	const ordered = kitchens
		.filter((k) => !isVisitorStore(k) && totals[k.id])
		.sort((a, b) => totals[b.id].cents - totals[a.id].cents);
	const samples = kitchens.filter((k) => !isVisitorStore(k) && !totals[k.id]);
	return { active: [...made, ...ordered], samples };
}

/** Stores that placed their first order between two totals: none before, at least one now. */
export function firstOrders(
	before: Record<string, { n: number }>,
	after: Record<string, { n: number }>
): string[] {
	return Object.keys(after).filter((id) => after[id].n > 0 && !(before[id]?.n > 0));
}
