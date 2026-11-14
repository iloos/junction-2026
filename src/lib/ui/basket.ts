/**
 * Words and grouping for the Kitchen's Basket view: what is coming on each delivery day, from every source (the
 * event plan, the usual order, chat, an outside agent), and what each line waits on. Pure; the Basket comes from
 * /kitchen-api/basket (9c's basketFor). The types mirror 9c's contract until core/services/basket.ts lands.
 */
import { day as dayLabel, money, readableName, storyTime } from './format';
import { salesUnitWords } from './request/words';
import type { BasketDay, BasketLine, BasketSource, BasketStage } from '$lib/core/services/basket';
import type { Origin as SourceKind } from '$lib/core/services/stages';

export type {
	Basket,
	BasketDay,
	BasketLine,
	BasketSource,
	BasketStage
} from '$lib/core/services/basket';
export type { Origin as SourceKind } from '$lib/core/services/stages';

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
	outside_agent: 'Outside agent',
	menu: 'Menu',
	kitchen: 'Kitchen order'
};

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/**
 * The chip a line's source shows: the specific words a chef recognises ("Christmas dinner buffet", "Usual
 * Thursday"), else the server's generic label ("From chat").
 */
export function sourceChip(s: BasketSource, date?: string): string {
	if (s.kind === 'usual' && date) return `Usual ${WEEKDAY.format(new Date(`${date}T12:00:00Z`))}`;
	if (s.kind === 'outside_agent') return KIND_WORDS.outside_agent;
	// Long titles ("Christmas dinner buffet, 140 guests") are cut at the first comma for the chip.
	const short = s.title.split(/,|·/)[0].trim();
	if (short && short.length <= 28) return short;
	return s.label || (short ? `${short.slice(0, 27)}…` : KIND_WORDS[s.kind]);
}

/** "3 can't be ordered for this day: Joulutorttu, …" or null. */
export function cannotOrderSentence(d: BasketDay): string | null {
	const n = d.counts.cannotOrder;
	if (!n) return null;
	const names = (d.cannotOrderNames ?? []).map((x) => readableName(x));
	const shown = names.slice(0, 3).join(', ');
	return `${n} can't be ordered for this day${shown ? `: ${shown}${names.length > 3 ? ', …' : ''}` : ''}.`;
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

export interface StageRun {
	stage: BasketStage;
	words: string;
	lines: BasketLine[];
	cents: number;
}

/**
 * Lines grouped under their stage, in reading order (what waits on the chef first), each group with its count and
 * subtotal. The group heading says the stage once, so the rows under it carry no per-row chip.
 */
export function stageRuns(lines: readonly BasketLine[]): StageRun[] {
	return STAGES.map((stage) => {
		const of = lines
			.filter((l) => l.stage === stage)
			.sort((a, b) => a.productName.localeCompare(b.productName));
		return { stage, words: STAGE_WORDS[stage], lines: of, cents: centsOf(of) };
	}).filter((r) => r.lines.length);
}

/** What can't be ordered for the day, as a count with its reason and the readable names behind a fold. */
export function cannotOrder(d: BasketDay): { headline: string; names: string[] } | null {
	const n = d.counts.cannotOrder;
	if (!n) return null;
	return {
		headline: `${n} product${n === 1 ? '' : 's'} can't be ordered for this day`,
		names: (d.cannotOrderNames ?? []).map((x) => readableName(x))
	};
}
