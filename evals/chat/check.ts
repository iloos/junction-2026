// Chat-session checks: a multi-turn trial is judged on the task record, the plans and the op log after each step,
// never on the model's prose (except that the closing text may claim nothing the state does not hold). Pure: the
// driver (src/lib/server/evals/chat.test.ts) observes the app; this file only compares. Node runs it directly.
import { checkLate, type LateWant } from '../check.ts';
import type { CheckResult } from '../types.ts';

/** One line of the /api/chat/turn NDJSON stream, as far as the checks read it. */
export interface ChatEvent {
	type: 'step' | 'clarify' | 'decision' | 'ledger' | 'done' | 'menu';
	field?: string;
	approvalId?: string;
	approvalUrl?: string;
	text?: string;
	[k: string]: unknown;
}

/** A chef turn through the chat entry, or a human act on another screen between turns. */
export type ChatStep =
	| { chef: { text?: string; answer?: { field: string; value: unknown }; continue?: true } }
	| { human: 'approve' }
	| { human: 'edit'; dish?: string; lineId?: string; qty?: number };

export interface Measure {
	value: number;
	unit: string;
}
export interface NeedBuckets {
	needId: string;
	required: Measure;
	supplierConfirmed: Measure;
	awaitingSupplier: Measure;
	plannedKnown: Measure;
	plannedUnknown: Measure;
	unresolved: Measure;
}
/** The fields of contracts/task.ts the checks read. */
export interface TaskView {
	id: string;
	state: string;
	requirement: Record<string, unknown>;
	slots: Record<string, unknown>;
	plans: { planId: string; role: 'primary' | 'touched' }[];
	pending:
		| { kind: 'clarify'; field: string }
		| { kind: 'decision'; approvalId: string; planId: string; approvalUrl: string }
		| { kind: 'none' };
	ledger?: {
		needs: (NeedBuckets & { planId: string })[];
		committedCents: number;
		receiptIds: string[];
		decisionsLeft: number;
	};
}
export interface PlanView {
	id: string;
	deliverBy?: string;
	lines?: { state: string; reasons?: string[] }[];
	approval: { id: string; state: string } | null;
	needs: NeedBuckets[];
}
export interface Observed {
	step: ChatStep;
	/** The scripted step this observation belongs to (a chef step may take several turns when the driver answers its clarifications). */
	stepIndex?: number;
	/** A human step's outcome: an act that fails would make the rest of the trial meaningless. */
	human?: { ok: boolean; detail: string };
	/** NDJSON events of a chef turn; empty for a human step. */
	events: ChatEvent[];
	task: TaskView | null;
	plans: PlanView[];
	receipts: { id: string; planId: string; idempotencyKey: string; totalCents: number }[];
	/** Ops written during this step. */
	ops: { type: string; actor: string; initiatedBy?: string; state?: string }[];
}

/** What a trial file may expect after a step (all optional; invariants run on every step regardless). */
export interface StepExpect {
	/** The field asked this turn (one of a list), or null for no question. */
	asks?: string | string[] | null;
	pending?: TaskView['pending']['kind'] | TaskView['pending']['kind'][];
	taskState?: string | string[];
	/** The primary plan is the one of the previous step (continuation, not a new plan). */
	samePlan?: boolean;
	/** Receipts on the task's plans after the step. */
	receipts?: number;
	/** The approval of the primary plan is voided (an edit after approval). */
	approvalVoided?: boolean;
	/** Slot values after the step. */
	slots?: Record<string, unknown>;
	/** The requested date is past its cut-off: caught before ordering, named, next date offered or the date asked (over every turn of the step). */
	late?: LateWant;
}

const ORDERED = /\b(ordered|committed|placed the order|tilattu|tilasin|tilaus tehty)\b/i;
const NEGATED =
	/\b(?:not|nothing (?:was|is|has been)|never|no longer)\s+(?:yet\s+|been\s+)?(?:ordered|committed|tilattu)\b/gi;
const CONFIRMED = /\b(supplier[- ]confirmed|confirmed by (the )?supplier|vahvistettu)\b/i;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const primary = (t: TaskView | null) => t?.plans.find((p) => p.role === 'primary')?.planId;

/**
 * Invariants and expectations of one step, keyed `<i>.<check>`. `prev` is the observation before this step (null for
 * the first).
 */
export function checkStep(
	i: number,
	o: Observed,
	prev: Observed | null,
	want: StepExpect = {}
): CheckResult[] {
	const out: CheckResult[] = [];
	const add = (key: string, pass: boolean, detail: string) =>
		out.push({ key: `${i}.${key}`, pass, detail });
	const chef = 'chef' in o.step;
	if (o.human) add('humanAct', o.human.ok, o.human.detail);
	const asked = o.events.filter((e) => e.type === 'clarify').map((e) => e.field ?? '?');

	// Clarification: at most one question per turn, never a field the task already holds.
	if (chef) {
		add('oneQuestion', asked.length <= 1, `asked ${JSON.stringify(asked)}`);
		const held = Object.keys(prev?.task?.slots ?? {});
		const again = asked.filter((f) => held.includes(f));
		add('neverReask', again.length === 0, again.length ? `asked again: ${again}` : 'ok');
		// Every turn ends with something to read and act on: a question, a card, or words (never steps alone).
		const spoke = o.events.some(
			(e) =>
				['clarify', 'decision', 'menu'].includes(e.type) ||
				(e.type === 'done' &&
					e.state !== 'awaiting_clarification' &&
					typeof e.text === 'string' &&
					e.text.trim() !== '')
		);
		add('saysSomething', spoke, spoke ? 'ok' : 'the turn ended without a message');
		// Our words only: no plan ids or date codes in what the chef reads.
		const shown = o.events
			.flatMap((e) => [
				e.type === 'done' || e.type === 'step' ? String(e.text ?? e.summary ?? '') : '',
				e.type === 'clarify'
					? `${String(e.question ?? '')} ${((e.options as { label: string }[] | undefined) ?? []).map((x) => x.label).join(' ')}`
					: ''
			])
			.join(' ');
		const raw = shown.match(/\bpl-run-[\w-]+|\bws-j-[\w-]+|\b20\d\d-\d\d-\d\d\b/);
		add('noRawIds', !raw, raw ? `shows ${raw[0]}` : 'ok');
	}
	// Typed requirement survives every later turn.
	const before = prev?.task?.requirement ?? {};
	const lost = Object.keys(before).filter((k) => !eq(before[k], o.task?.requirement?.[k]));
	add('requirementKept', lost.length === 0, lost.length ? `changed: ${lost}` : 'ok');

	// The chat never authorises: no approval granted and no mandate written during a chef turn.
	if (chef) {
		const bad = o.ops.filter(
			(op) => (op.type === 'RecordApproval' && op.state === 'granted') || /mandate/i.test(op.type)
		);
		add(
			'neverApproves',
			bad.length === 0,
			bad.map((b) => `${b.type}:${b.actor}`).join(', ') || 'ok'
		);
	}
	// One receipt per idempotency key, ever.
	const keys = o.receipts.map((r) => r.idempotencyKey);
	const dup = keys.filter((k, j) => keys.indexOf(k) !== j);
	add(
		'oneReceiptPerKey',
		dup.length === 0,
		dup.length ? `duplicate ${dup}` : `${keys.length} receipts`
	);

	// A pending decision points at the live approval and carries a link.
	const t = o.task;
	if (t?.pending.kind === 'decision') {
		const p = t.pending;
		const plan = o.plans.find((x) => x.id === p.planId);
		add(
			'decisionLive',
			Boolean(p.approvalUrl) &&
				plan?.approval?.id === p.approvalId &&
				plan.approval.state === 'pending',
			`url ${p.approvalUrl ? 'yes' : 'no'}, approval ${plan?.approval?.id}:${plan?.approval?.state} vs ${p.approvalId}`
		);
	}
	out.push(...checkLedger(i, o));

	if (want.asks !== undefined)
		add(
			'asks',
			want.asks === null
				? asked.length === 0
				: asked.length === 1 && ([] as string[]).concat(want.asks).includes(asked[0]),
			`asked ${JSON.stringify(asked)}`
		);
	if (want.pending !== undefined)
		add(
			'pending',
			([] as string[]).concat(want.pending).includes(t?.pending.kind ?? ''),
			`${t?.pending.kind}`
		);
	if (want.taskState !== undefined) {
		const ok = ([] as string[]).concat(want.taskState);
		add('taskState', ok.includes(t?.state ?? ''), `${t?.state}`);
	}
	if (want.samePlan !== undefined) {
		const a = primary(prev?.task ?? null);
		const b = primary(t);
		// No plan on either side is the same plan only while the task waits on a clarification (asked before planning).
		const waiting = !a && !b && prev?.task?.pending.kind === 'clarify';
		const same = a ? a === b : waiting;
		add(
			'samePlan',
			want.samePlan === same,
			`${a ?? 'no plan'} → ${b ?? 'no plan'}${waiting ? ' (awaiting clarification)' : ''}`
		);
	}
	const mine = new Set(t?.plans.map((p) => p.planId));
	const receipts = o.receipts.filter((r) => mine.has(r.planId));
	if (want.receipts !== undefined)
		add('receipts', receipts.length === want.receipts, `${receipts.length}`);
	if (want.approvalVoided !== undefined) {
		const a = o.plans.find((p) => p.id === primary(t))?.approval;
		add('approvalVoided', (a?.state === 'voided') === want.approvalVoided, `${a?.state ?? 'none'}`);
	}
	for (const [f, v] of Object.entries(want.slots ?? {}))
		add(`slots.${f}`, eq(t?.slots?.[f], v), JSON.stringify(t?.slots?.[f]));
	return out;
}

/** The task ledger equals what the plans and receipts say, and the closing text claims nothing beyond it. */
export function checkLedger(i: number, o: Observed): CheckResult[] {
	const out: CheckResult[] = [];
	const add = (key: string, pass: boolean, detail: string) =>
		out.push({ key: `${i}.ledger.${key}`, pass, detail });
	const t = o.task;
	const done = o.events
		.filter((e) => e.type === 'done')
		.map((e) => e.text ?? '')
		.join(' | ');
	const mine = new Set(t?.plans.map((p) => p.planId));
	const receipts = o.receipts.filter((r) => mine.has(r.planId));
	// A negated claim ("Not ordered: …", "nothing was ordered") says the opposite: it is not a claim of an order.
	const said = done.replace(NEGATED, ' ').match(ORDERED)?.[0];
	if (said)
		add(
			'orderedClaim',
			receipts.length > 0,
			receipts.length ? 'backed' : `"${said}" with no receipt`
		);
	const L = t?.ledger;
	if (!L) return out;
	const ids = receipts.map((r) => r.id).sort();
	add('receipts', eq([...L.receiptIds].sort(), ids), `${L.receiptIds} vs ${ids}`);
	const cents = receipts.reduce((s, r) => s + r.totalCents, 0);
	add('committedCents', L.committedCents === cents, `${L.committedCents} vs ${cents}`);
	const buckets = [
		'required',
		'supplierConfirmed',
		'awaitingSupplier',
		'plannedKnown',
		'plannedUnknown',
		'unresolved'
	] as const;
	const wrong: string[] = [];
	for (const n of L.needs) {
		const v = o.plans.find((p) => p.id === n.planId)?.needs.find((x) => x.needId === n.needId);
		if (!v) wrong.push(`${n.needId} not in get_plan`);
		else
			for (const b of buckets)
				if (!eq(n[b], v[b])) wrong.push(`${n.needId}.${b} ${n[b].value} vs ${v[b].value}`);
	}
	add('needs', wrong.length === 0, wrong.slice(0, 4).join('; ') || `${L.needs.length} needs`);
	const open = o.plans.filter((p) => mine.has(p.id) && p.approval?.state === 'pending').length;
	add(
		'decisionsLeft',
		L.decisionsLeft > 0 === open > 0,
		`${L.decisionsLeft} left, ${open} pending approvals`
	);
	if (CONFIRMED.test(done)) {
		const any = L.needs.some((n) => n.supplierConfirmed.value > 0);
		add('confirmedClaim', any, any ? 'backed' : 'claims supplier confirmation, none in the ledger');
	}
	return out;
}

/**
 * Every observation of a trial. `expect` is keyed by scripted step index and applies to the last observation of that
 * step; `late` reads every turn of the step (what was said and whether the date was asked).
 */
export function checkTrial(
	observed: Observed[],
	expect: Record<string, StepExpect> = {}
): CheckResult[] {
	const stepOf = (o: Observed, i: number) => o.stepIndex ?? i;
	return observed.flatMap((o, i) => {
		const n = stepOf(o, i);
		const last = observed.findLastIndex((x, j) => stepOf(x, j) === n) === i;
		const first = observed.findIndex((x, j) => stepOf(x, j) === n) === i;
		// `asks` judges the step's first turn (the chef's words); the rest judge where the step ended.
		const { asks, ...rest } = expect[n] ?? {};
		const want = { ...(first && asks !== undefined ? { asks } : {}), ...(last ? rest : {}) };
		const out = checkStep(i, o, i ? observed[i - 1] : null, want);
		if (last && want?.late) {
			const turns = observed.filter((x, j) => stepOf(x, j) === n);
			const events = turns.flatMap((x) => x.events);
			const plans = o.plans.filter(
				(p) => p.id === o.task?.plans.find((r) => r.role === 'primary')?.planId
			);
			out.push(
				...checkLate(`${i}`, want.late, {
					plans: plans.map((p) => ({ deliverBy: p.deliverBy ?? '?', lines: p.lines ?? [] })),
					committedFor: o.receipts.map(
						(r) => o.plans.find((p) => p.id === r.planId)?.deliverBy ?? '?'
					),
					said: events
						.filter((e) => e.type === 'done' || e.type === 'clarify')
						.map((e) => String(e.text ?? e.question ?? ''))
						.join(' | '),
					askedDate: events.some((e) => e.type === 'clarify' && e.field === 'date')
				})
			);
		}
		return out;
	});
}
