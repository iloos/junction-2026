/**
 * How the dock renders a task's events, as plain data so it can be tested against a recorded turn: a turn's tool
 * steps fold into one "Worked N steps" line, and the ledger becomes one outcome line. Every number comes from the
 * events; nothing here can approve.
 */
import type { TaskLedger } from '$lib/core/contracts/task';
import { money } from '$lib/ui/format';
import type { ChatEvent } from './types';
import type { OpEnvelope } from '$lib/core/contracts';

/** `at`: when it arrived in this tab (ms), for the turn's duration; absent on a restored task. */
export type Entry =
	| { kind: 'chef'; text: string; at?: number }
	| { kind: 'event'; e: ChatEvent; at?: number }
	/** What happened outside the chat (the chef on the Kitchen page, an order), in one plain line: no model call. */
	| { kind: 'system'; text: string; at?: number };
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
		if (x.kind === 'event' && x.e.type === 'step') n++;
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

/**
 * What happened outside the chat to the task's plans, in one plain line (no model call): an approval granted or
 * kept held on the Kitchen page or in the dock, an approval voided by a change, an order and its receipt. Null when
 * nothing in the burst is worth a line.
 */
export function describeOps(ops: readonly OpEnvelope[]): string | null {
	const parts: string[] = [];
	const approvals = new Map<
		string,
		Extract<OpEnvelope['op'], { type: 'RecordApproval' }>['approval']
	>();
	let edited = false;
	for (const { op } of ops) {
		if (op.type === 'RecordApproval') approvals.set(op.approval.id, op.approval);
		if (op.type === 'EditLine' || op.type === 'ProposeSubstitute') edited = true;
	}
	for (const a of approvals.values()) {
		const n = a.lineIds.length;
		const lines = `${n} ${n === 1 ? 'line' : 'lines'}`;
		if (a.state === 'granted') parts.push(`You approved ${lines}.`);
		else if (a.state === 'denied')
			parts.push(`You kept ${lines} held: nothing more to order there.`);
		else if (a.state === 'invalidated' || a.state === 'expired')
			parts.push('The plan changed: the earlier approval no longer applies.');
	}
	for (const { op } of ops) {
		if (op.type !== 'CommitOrder') continue;
		if (op.outcome.result === 'committed') {
			const aw = op.outcome.receipt.awaitingSupplier.length;
			parts.push(
				`Ordered: receipt ${op.outcome.receipt.id}${aw ? ` (${aw} awaiting the supplier)` : ''}.`
			);
		} else parts.push(`The order didn't go through: ${op.outcome.error.message}`);
	}
	if (!parts.length && edited) parts.push('The plan changed in the Kitchen.');
	return parts.length ? [...new Set(parts)].join(' ') : null;
}

/** Ops a chat turn wrote itself: its own outcome line already says what they did. */
export const fromChat = (o: OpEnvelope) => /^(chat|task)\b/.test(o.via);
