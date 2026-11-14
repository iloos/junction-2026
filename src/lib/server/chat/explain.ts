import type { Llm } from '$lib/core/ports';
import type { TaskLedger } from '$lib/core/contracts/task';
import { outcomeTextCheckpoint } from '$lib/server/review/outcome';
import { ledgerTotals } from '$lib/server/tasks/ledger';

/**
 * The chat's reply about a task, written by Gemini (job `explain`) from the ledger's facts and checked before it is
 * sent: every number must be one the facts contain, "ordered" needs a receipt, "supplier confirmed" needs a
 * receipt-confirmed quantity, and "approved" needs no decision left. A reply that fails the check, or no model, gives
 * the template sentence (`fallback`) instead. The model only words what the ledger says; it never decides.
 */
export interface Explained {
	text: string;
	source: 'gemini' | 'template';
	model?: string;
	ms: number;
	/** Why the model's text was not used. */
	rejected?: string;
}

const SYSTEM =
	'You answer a chef about one purchasing task, in at most three short sentences, in the language of the question ' +
	'(English or Finnish). Use only the facts given: never add a number, product or state that is not in them. ' +
	'Say "ordered" only if receipts is non-empty; say "supplier confirmed" only for supplierConfirmed amounts above zero; ' +
	'held lines are "waiting for your approval in the Kitchen screen". Never offer to approve. Reply with the text only.';

/** The facts the model may use, small and typed. */
export function factsOf(l: TaskLedger) {
	const t = ledgerTotals(l);
	return {
		needs: l.needs.slice(0, 12).map((n) => ({
			label: n.label,
			unit: n.required.unit,
			required: n.required.value,
			supplierConfirmed: n.supplierConfirmed.value,
			awaitingSupplier: n.awaitingSupplier.value,
			planned: n.plannedKnown.value + n.plannedUnknown.value,
			unresolved: n.unresolved.value
		})),
		totals: t,
		committedEuros: Math.round(l.committedCents) / 100,
		receipts: l.receiptIds.length,
		decisionsLeft: l.decisionsLeft,
		nextAction: l.nextAction,
		asOf: l.asOf
	};
}

const NUM = /(?<![\p{L}\d.,])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu;
const ORDERED = /\b(ordered|tilattu|tilattiin|tilasin|tilannut)\b/i;
/** Any "confirmed" or "delivered" claim: the ledger backs it only with a receipt-confirmed amount. */
const CONFIRMED = /\b(confirmed|delivered|vahvist\p{L}*|toimitettu|toimitettiin)\b/iu;
const NOT_CONFIRMED =
	/\b(not|no|never|un|awaiting|until|before)\s+(yet\s+)?(supplier[- ])?(confirmed|delivered)|\bei (ole )?(vielä )?(vahvistettu|toimitettu)/iu;
const APPROVED = /\b(approved|hyväksytty|hyväksyin)\b/i;

/** Numbers the facts contain, as the strings a reply may write them. */
function allowedNumbers(f: ReturnType<typeof factsOf>): Set<number> {
	const out = new Set<number>();
	const add = (n: number) => {
		out.add(Math.round(n * 100) / 100);
		out.add(Math.round(n));
	};
	for (const n of f.needs)
		[n.required, n.supplierConfirmed, n.awaitingSupplier, n.planned, n.unresolved].forEach(add);
	for (const t of Object.values(f.totals))
		[t.required, t.supplierConfirmed, t.awaitingSupplier, t.planned, t.unresolved].forEach(add);
	[f.committedEuros, f.receipts, f.decisionsLeft, f.needs.length].forEach(add);
	// Numbers inside the labels and the next-action sentence are facts too.
	for (const s of [f.nextAction, ...f.needs.map((n) => n.label)])
		for (const m of s.matchAll(NUM)) add(Number(m[0].replace(',', '.')));
	return out;
}

/** Whether a reply says only what the facts back. Returns the first unbacked claim, or null. */
export function unbacked(text: string, l: TaskLedger): string | null {
	const f = factsOf(l);
	const ok = allowedNumbers(f);
	for (const m of text.matchAll(NUM)) {
		const v = Math.round(Number(m[0].replace(',', '.')) * 100) / 100;
		if (!ok.has(v) && !ok.has(Math.round(v))) return `number ${m[0]}`;
	}
	if (
		ORDERED.test(text) &&
		!/\bnot (yet )?ordered\b|\bei (ole )?tilattu\b/i.test(text) &&
		f.receipts === 0
	)
		return '"ordered" without a receipt';
	const confirmed = Object.values(f.totals).some((t) => t.supplierConfirmed > 0);
	if (CONFIRMED.test(text) && !NOT_CONFIRMED.test(text) && !confirmed)
		return '"confirmed" or "delivered" without a confirmed amount';
	if (APPROVED.test(text) && !/\bnot (yet )?approved\b/i.test(text) && f.decisionsLeft > 0)
		return '"approved" with decisions left';
	return null;
}

export async function explain(
	question: string,
	ledger: TaskLedger,
	fallback: string,
	o: { llm?: Llm | null; signal?: AbortSignal }
): Promise<Explained> {
	const t0 = performance.now();
	const ms = () => Math.round(performance.now() - t0);
	if (!o.llm) return { text: fallback, source: 'template', ms: ms() };
	try {
		const res = await o.llm.generate({
			system: SYSTEM,
			prompt: JSON.stringify({ question: question.slice(0, 300), facts: factsOf(ledger) }),
			maxTokens: 300,
			signal: o.signal
		});
		const text = res.text.trim();
		if (res.model === 'fixture' || !text) return { text: fallback, source: 'template', ms: ms() };
		const bad = unbacked(text, ledger);
		if (bad)
			return { text: fallback, source: 'template', model: res.model, ms: ms(), rejected: bad };
		return { text: text.slice(0, 600), source: 'gemini', model: res.model, ms: ms() };
	} catch (e) {
		return {
			text: fallback,
			source: 'template',
			ms: ms(),
			rejected: String((e as Error)?.message ?? e).slice(0, 120)
		};
	}
}
