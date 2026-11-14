/**
 * The Kitchen's first read (north star): "your kitchen's week, handled". Three short groups of one-sentence rows:
 * what needs the chef (one action each), what the agent did (planned, swapped, re-planned on a shortage, ordered,
 * and why), and what is coming (deliveries). Built from the Basket and from shortage notices; pure.
 */
import type { BasketDay } from './basket';
import { sourceChip } from './basket';
import { day as dayLabel, money, readableName, storyTime, unitWord } from './format';

export type LedgerKind =
	'decide' | 'order' | 'swap' | 'shortage' | 'ordered' | 'planned' | 'delivery';

export interface LedgerEntry {
	id: string;
	kind: LedgerKind;
	/** One sentence a chef reads in five seconds. */
	text: string;
	/** The quieter why, when there is one. */
	why?: string;
	/** Money, already formatted. */
	value?: string;
	/** The plan an action applies to. */
	planId?: string;
	date?: string;
	/** The row just landed (a live notice): it flashes. */
	fresh?: boolean;
}

export interface Ledger {
	needsYou: LedgerEntry[];
	done: LedgerEntry[];
	coming: LedgerEntry[];
}

/** shortage.replanned's detail (S1's ShortageReplanned), the fields the ledger reads. */
export interface ShortageNotice {
	shortageId: string;
	productId: string;
	productName: string;
	had: number;
	left: number;
	unit: string;
	kitchens: {
		kitchenId: string;
		kitchenName: string;
		planId: string | null;
		outcome: 'unaffected' | 'kept' | 'swapped' | 'held' | 'short';
		changed: unknown[];
		swaps: { fromName: string; toName: string }[];
		allowedBy: string;
		waitsForPerson: number;
		why: string;
	}[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The ledger for one kitchen: its basket days and the shortage notices that reached it. */
export function buildLedger(
	days: readonly BasketDay[],
	notices: readonly ShortageNotice[] = [],
	kitchenId?: string
): Ledger {
	const needsYou: LedgerEntry[] = [];
	const done: LedgerEntry[] = [];
	const coming: LedgerEntry[] = [];

	for (const n of notices) {
		const k = kitchenId ? n.kitchens.find((x) => x.kitchenId === kitchenId) : n.kitchens[0];
		if (!k || k.outcome === 'unaffected') continue;
		const what = `Valio ran short of ${readableName(n.productName)} (${n.had} → ${n.left} ${unitWord(n.unit, n.left)})`;
		const did =
			k.outcome === 'swapped'
				? `your agent swapped ${k.swaps.map((s) => `${readableName(s.fromName)} for ${readableName(s.toName)}`).join(', ')}`
				: k.outcome === 'held'
					? `your agent found a swap and holds it for you`
					: k.outcome === 'kept'
						? 'your order keeps its share'
						: 'nothing your rules allow covers it';
		done.push({
			id: `short-${n.shortageId}`,
			kind: 'shortage',
			text: `${what}: ${did}.`,
			why: k.why || k.allowedBy,
			planId: k.planId ?? undefined,
			fresh: true
		});
	}

	for (const d of days) {
		const when = dayLabel(d.date);
		for (const s of d.sources) {
			const lines = d.lines.filter((l) => l.planId === s.planId);
			if (!lines.length) continue;
			const name = sourceChip(s, d.date);
			const held = lines.filter((l) => l.stage === 'held');
			const ready = lines.filter((l) => l.stage === 'proposed');
			const ordered = lines.filter((l) => l.stage === 'ordered');
			const cents = (ls: typeof lines) => ls.reduce((a, l) => a + (l.lineCents ?? 0), 0);
			if (held.length)
				needsYou.push({
					id: `held-${s.planId}`,
					kind: 'decide',
					text: `${plural(held.length, 'line')} for ${name} ${held.length === 1 ? 'waits' : 'wait'} for your decision`,
					why: d.due
						? `Decide before ${storyTime(d.due)}; nothing is ordered until you do.`
						: undefined,
					value: money(cents(held)),
					planId: s.planId,
					date: d.date
				});
			if (ready.length)
				needsYou.push({
					id: `ready-${s.planId}`,
					kind: 'order',
					text: `${plural(ready.length, 'line')} for ${name} ${ready.length === 1 ? 'is' : 'are'} inside your rules and can be ordered`,
					value: money(cents(ready)),
					planId: s.planId,
					date: d.date
				});
			const swaps = lines.filter((l) => l.substituteFor);
			if (swaps.length)
				done.push({
					id: `swap-${s.planId}`,
					kind: 'swap',
					text: `Found replacements for ${plural(new Set(swaps.map((l) => l.substituteFor)).size, 'product')} Valio can't supply for ${name}`,
					why: [...new Set(swaps.map((l) => readableName(l.substituteFor!)))]
						.slice(0, 2)
						.join(', '),
					planId: s.planId,
					date: d.date
				});
			done.push({
				id: `plan-${s.planId}`,
				kind: 'planned',
				text: `Planned ${name}: ${plural(lines.length, 'line')} for ${when}`,
				value: money(cents(lines)),
				planId: s.planId,
				date: d.date
			});
			if (ordered.length)
				done.push({
					id: `ordered-${s.planId}`,
					kind: 'ordered',
					text: `Ordered ${plural(ordered.length, 'line')} for ${name}`,
					value: money(cents(ordered)),
					planId: s.planId,
					date: d.date
				});
		}
		coming.push({
			id: `delivery-${d.date}`,
			kind: 'delivery',
			text: `Delivery ${when}: ${plural(d.lines.length, 'line')}${d.counts.cannotOrder ? `, ${d.counts.cannotOrder} can't be ordered` : ''}`,
			value: money(d.totals.all),
			date: d.date
		});
	}
	return { needsYou, done, coming };
}
