/**
 * How the dock renders a task's events, as plain data so it can be tested against a recorded turn: a turn's tool
 * steps fold into one "Worked N steps" line, and the ledger becomes one outcome line. Every number comes from the
 * events; nothing here can approve.
 */
import type { TaskLedger } from '$lib/core/contracts/task';
import { money } from '$lib/ui/format';
import type { ChatEvent } from './types';

/** `at`: when it arrived in this tab (ms), for the turn's duration; absent on a restored task. */
export type Entry =
	{ kind: 'chef'; text: string; at?: number } | { kind: 'event'; e: ChatEvent; at?: number };
export type StepEvent = Extract<ChatEvent, { type: 'step' }>;
export type Row =
	| { kind: 'steps'; steps: StepEvent[]; ms: number | null; i: number }
	| { kind: 'entry'; x: Entry; i: number };

/** Consecutive steps fold into one row, timed from the chef's message that started the turn. */
export function foldRows(entries: readonly Entry[]): Row[] {
	const out: Row[] = [];
	let since: number | undefined;
	entries.forEach((x, i) => {
		if (x.kind === 'chef') since = x.at;
		const prev = out.at(-1);
		if (x.kind === 'event' && x.e.type === 'step') {
			const row: Extract<Row, { kind: 'steps' }> =
				prev?.kind === 'steps' ? prev : { kind: 'steps', steps: [], ms: null, i };
			if (row !== prev) out.push(row);
			row.steps.push(x.e);
			row.ms = since !== undefined && x.at !== undefined ? x.at - since : null;
			return;
		}
		out.push({ kind: 'entry', x, i });
	});
	return out;
}

/** "Worked 3 steps · 2.1 s", with refusals counted. */
export function workedLine(r: Extract<Row, { kind: 'steps' }>): string {
	const n = r.steps.length;
	return `Worked ${n} ${n === 1 ? 'step' : 'steps'}${r.ms !== null ? ` · ${(r.ms / 1000).toFixed(1)} s` : ''}`;
}

/** Steps so far in the turn that is running, for the indicator ("step 3"). */
export function stepsSinceChef(entries: readonly Entry[]): number {
	let n = 0;
	for (let j = entries.length - 1; j >= 0; j--) {
		const x = entries[j];
		if (x.kind === 'chef') break;
		if (x.e.type === 'step') n++;
	}
	return n;
}

/** The ledger as one outcome line: decisions left, what was ordered, what is still not covered. */
export function outcomeLine(l: TaskLedger): string {
	const short = l.needs.filter((n) => n.unresolved.value > 0).length;
	const orders = l.receiptIds.length;
	const parts = [
		l.decisionsLeft === 0
			? 'nothing waits for a chef'
			: `${l.decisionsLeft} ${l.decisionsLeft === 1 ? 'decision' : 'decisions'} for a chef`,
		orders
			? `ordered ${money(l.committedCents)} on ${orders} ${orders === 1 ? 'order' : 'orders'}`
			: 'nothing ordered',
		...(short ? [`${short} ${short === 1 ? 'need' : 'needs'} not covered`] : [])
	];
	const s = parts.join(' · ');
	return s[0].toUpperCase() + s.slice(1);
}
