/**
 * Words and grouping for the Kitchen's Basket view: what is coming on each delivery day, from every source (the
 * event plan, the usual order, chat, an outside agent), and what each line waits on. Pure; the Basket comes from
 * /kitchen-api/basket (9c's basketFor). The types mirror 9c's contract until core/services/basket.ts lands.
 */
import { day as dayLabel, money, storyTime } from './format';
import { salesUnitWords } from './request/words';

export type BasketStage = 'proposed' | 'held' | 'approved' | 'ordered';
/** Where a plan came from: `Plan.origin`, set by the server at each entry (never a tool input). */
export type SourceKind = 'event' | 'usual' | 'request' | 'chat' | 'agent' | 'menu';

export interface BasketSource {
	planId: string;
	kind: SourceKind;
	title: string;
	label?: string;
	startedBy: string;
	version: number;
	approvalId: string | null;
}
export interface BasketLine {
	planId: string;
	lineId: string;
	productId: string;
	productName: string;
	qty: { value: number; unit: string };
	unitCents: number | null;
	lineCents: number | null;
	stage: BasketStage;
	reasons: string[];
	need?: string;
	substituteFor?: string;
	cutoff: string | null;
	imageUrl?: string;
}
export interface BasketDay {
	date: string;
	sources: BasketSource[];
	lines: BasketLine[];
	totals: Record<BasketStage | 'all', number>;
	budget: {
		week: string;
		capCents: number | null;
		orderedCents: number;
		ifAllOrderedCents: number;
	};
	due: string | null;
	counts: {
		orderableNow: number;
		waitingOnDecision: number;
		decisions: number;
		cannotOrder: number;
	};
}
export interface Basket {
	kitchenId: string;
	days: BasketDay[];
}

/** The order a chef reads stages in: what needs them first, what is done last. */
export const STAGES: BasketStage[] = ['held', 'proposed', 'approved', 'ordered'];

export const STAGE_WORDS: Record<BasketStage, string> = {
	held: 'Waits on you',
	proposed: 'Can order now',
	approved: 'Approved, not ordered',
	ordered: 'Ordered'
};

const KIND_WORDS: Record<SourceKind, string> = {
	event: 'Event',
	usual: 'Usual order',
	request: 'Request',
	chat: 'Asked in chat',
	agent: 'Outside agent',
	menu: 'Menu'
};

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** The chip a line's source shows: short words a chef recognises ("Christmas buffet", "Usual Thursday"). */
export function sourceChip(s: BasketSource, date?: string): string {
	if (s.label) return s.label;
	if (s.kind === 'usual' && date) return `Usual ${WEEKDAY.format(new Date(`${date}T12:00:00Z`))}`;
	if (s.kind === 'chat' || s.kind === 'agent') return KIND_WORDS[s.kind];
	// Long titles ("Christmas dinner buffet, 140 guests") are cut at the first comma for the chip.
	const short = s.title.split(/,|·/)[0].trim();
	return short.length > 28 ? `${short.slice(0, 27)}…` : short || KIND_WORDS[s.kind];
}

const centsOf = (lines: readonly BasketLine[]) => lines.reduce((s, l) => s + (l.lineCents ?? 0), 0);
const byStage = (a: BasketLine, b: BasketLine) =>
	STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.productName.localeCompare(b.productName);

export interface SourceGroup {
	source: BasketSource;
	chip: string;
	lines: BasketLine[];
	cents: number;
	/** Lines of this plan that can go now, and those waiting on a person. */
	orderable: number;
	held: number;
}

/** Lines grouped by the plan they came from, groups in the day's source order, lines by stage. */
export function groupBySource(d: BasketDay): SourceGroup[] {
	return d.sources
		.map((source) => {
			const lines = d.lines.filter((l) => l.planId === source.planId).sort(byStage);
			return {
				source,
				chip: sourceChip(source, d.date),
				lines,
				cents: centsOf(lines),
				orderable: lines.filter((l) => l.stage === 'proposed').length,
				held: lines.filter((l) => l.stage === 'held').length
			};
		})
		.filter((g) => g.lines.length);
}

/** Every line of the day, by stage (what waits on the chef first), each with its source chip. */
export function flatByStage(d: BasketDay): { line: BasketLine; chip: string }[] {
	const chip = new Map(d.sources.map((s) => [s.planId, sourceChip(s, d.date)]));
	return [...d.lines].sort(byStage).map((line) => ({ line, chip: chip.get(line.planId) ?? '' }));
}

/** The day's headline: "Thu 10 Dec · 15 lines · €931.30". */
export function dayHeadline(d: BasketDay): string {
	const n = d.lines.length;
	return `${dayLabel(d.date)} · ${n} line${n === 1 ? '' : 's'} · ${money(d.totals.all)}`;
}

/** What the chef should do for this day, in one sentence, or null when nothing waits. */
export function dayAction(d: BasketDay): string | null {
	const parts: string[] = [];
	if (d.counts.decisions)
		parts.push(`${d.counts.decisions} decision${d.counts.decisions === 1 ? '' : 's'}`);
	if (d.counts.orderableNow)
		parts.push(`${d.counts.orderableNow} line${d.counts.orderableNow === 1 ? '' : 's'} can go now`);
	if (!parts.length) return null;
	return `${parts.join(' · ')}${d.due ? `, before ${storyTime(d.due)}` : ''}.`;
}

/** "€934 of €4,000 this week if all of it is ordered (€0 ordered so far)". */
export function budgetSentence(d: BasketDay): string | null {
	const b = d.budget;
	if (b.capCents == null) return null;
	return `${money(b.ifAllOrderedCents, { whole: true })} of ${money(b.capCents, { whole: true })} this week if all of it is ordered (${money(b.orderedCents, { whole: true })} ordered so far).`;
}

/** The share of the week's cap used so far and if everything is ordered, each 0..1 (for a meter). */
export function budgetShares(d: BasketDay): { ordered: number; ifAll: number } | null {
	const cap = d.budget.capCents;
	if (!cap) return null;
	const clamp = (x: number) => Math.max(0, Math.min(1, x));
	return {
		ordered: clamp(d.budget.orderedCents / cap),
		ifAll: clamp(d.budget.ifAllOrderedCents / cap)
	};
}

/** A line's quantity as ProductToken reads it: an amount with the chef's unit word ("13 packs", "20 kg"). */
export function tokenQty(q: BasketLine['qty']): { amount: number; unit: string } {
	return { amount: q.value, unit: salesUnitWords(q.value, q.unit).replace(/^\S+\s/, '') };
}
