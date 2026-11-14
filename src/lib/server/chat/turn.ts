import type { Plan, ToolName, ToolOutput } from '$lib/core/contracts';
import { ClarifyField, newTaskId, type Task, type TaskState } from '$lib/core/contracts/task';
import type { CallContext, Llm, Ports, TaskStore, ToolHandlers } from '$lib/core/ports';
import { runGoal } from '$lib/server/agent';
import { classifyGoal } from '$lib/server/agent/classify';
import type { ContextSource } from '$lib/server/agent/context';
import { withoutKitchen } from '$lib/server/agent/intent';
import {
	llmPlanner,
	scriptedPlanner,
	type AgentRun,
	type Planner,
	type StepRecord
} from '$lib/server/agent/loop';
import { buildRunPrincipal, principalContext } from '$lib/server/agent/principal';
import { newAgentRunId, startAgentRun } from '$lib/server/agent/runs';
import type { Slots } from '$lib/server/agent/types';
import type { Env } from '$lib/server/auth';
import { UNITS } from '$lib/server/request/lexicon';
import { parseRules } from '$lib/server/request/parse';
import { dayWords, ledgerSummary, readTask } from '$lib/server/tasks/outcome';
import { explain } from './explain';
import { understand } from './understand';
import { project } from '$lib/server/tasks/project';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { approvalUrl } from '$lib/server/tools/present';
import { serveTool } from '$lib/server/tools/serve';
import type { ChatEvent, ChatTurnInput } from '$lib/ui/chat/types';
import { decisionsDue, decisionsOf } from '$lib/ui/decisions';
import type { ReceiptView } from '$lib/ui/Receipt.svelte';

/**
 * One chat turn on a procurement task, in process: the third door onto `runGoal` (after MCP and REST), under the
 * chef's context ∩ the routine agent's scopes, so it can plan and order within the mandate and never approve.
 *
 * - `text`: a new task (the words become its requirement), or, on a task waiting for an answer, the answer in words.
 * - `answer {field, value}`: fills that typed slot only and re-runs the task's own requirement.
 * - `continue`: the `continue_task` script: get_plan → commit_order on the lines the mandate or a chef's grant allow
 *   (key `task:<id>:commit:<planVersion>`) → ledger.
 *
 * Every turn ends with the task written back (compare-and-set on its version), so a reconnect reads the task, not a
 * transcript. Lines: step* → clarify | decision? → ledger? → done.
 */
export interface ChatDeps {
	handlers: ToolHandlers;
	/** The chef's context (visitor cookie or key); the agent acts under it ∩ its own scopes. */
	ctx: CallContext;
	ports: Pick<Ports, 'store' | 'clock'> & { tasks?: TaskStore };
	workspaceId: string;
	kitchen: { id: string };
	/** Scenario date, YYYY-MM-DD. */
	today: string;
	env?: Env;
	/** The planner for new goals; by default the schema-constrained model on `llm` (the script on its failures), else the script. */
	planner?: Planner;
	/**
	 * The chat's model: understanding a message and wording answers from the ledger go through it (record and replay
	 * wrap it at this port). Absent: rules, script and template sentences.
	 */
	llm?: Llm | null;
	/** Per-job models (the route's router jobs); each defaults to `llm`. */
	models?: { understand?: Llm | null; explain?: Llm | null; plan?: Llm | null };
}

/**
 * Who plans: a routine order is the script's end to end (the request parser's reading of the words, every
 * candidate searched and quoted, the one that can still arrive, the stated amounts), so the same words give the same
 * basket on every door and nothing is left unplaced. Every other goal is the model's, and when it fails (a bad reply
 * twice, the provider down) the script takes that step.
 */
export function withFallback(model: Planner, script: Planner): Planner {
	return async (s, signal) => {
		if (s.intent?.kind === 'routine_order') return script(s, signal);
		try {
			return await model(s, signal);
		} catch (e) {
			if (signal.aborted) throw e;
			return script(s, signal);
		}
	};
}

/** Without a TaskStore on the ports, tasks live in memory per ports object (tests, a store without agent_tasks). */
const fallback = new WeakMap<object, TaskStore>();
function storeOf(ports: ChatDeps['ports']): TaskStore {
	if (ports.tasks) return ports.tasks;
	let s = fallback.get(ports);
	if (!s) fallback.set(ports, (s = memoryTaskStore()));
	return s;
}

const freshTaskId = () => newTaskId(Date.now(), Math.random().toString(36).slice(2, 6));

/** A slot value from a chip or typed words; quantities may carry their unit ("4 kg", "500 g"). */
export function readAnswer(field: ClarifyField, value: unknown): Slots {
	// A structured amount ({value, unit}) reads as its words.
	if (value && typeof value === 'object' && 'value' in value)
		value = `${String((value as { value: unknown }).value)} ${String((value as { unit?: unknown }).unit ?? '')}`;
	const raw =
		typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
	if (!raw) return {};
	if (field === 'qty' || field === 'guests') {
		const m = raw.match(/^(\d+(?:[.,]\d+)?)\s*([\p{L}.]*)/u);
		if (!m) {
			// Words ("make it four kilos", "neljä kiloa"): the request parser's own number and unit reading.
			const item = parseRules(raw, '2000-01-01').items.find((i) => i.qty !== null);
			if (!item || item.qty === null) return {};
			if (field === 'guests') return { guests: Math.round(item.qty) };
			const stated = item.unit && !item.ambiguities.some((a) => a.startsWith('no unit given'));
			return stated ? { qty: item.qty, unit: item.unit! } : { qty: item.qty };
		}
		const n = Number(m[1].replace(',', '.'));
		if (field === 'guests') return { guests: Math.round(n) };
		const u = UNITS.find((x) => x.forms.includes(m[2].toLowerCase()));
		return u ? { qty: Math.round(n * u.factor * 1000) / 1000, unit: u.unit } : { qty: n };
	}
	return { [field]: raw.slice(0, 200) };
}

/** Steps as the dock shows them: our summary of each result, a link to the plan it touched. */
function stepEvents(taskId: string, steps: StepRecord[]): ChatEvent[] {
	return steps.map((s) => {
		const plan = s.ok ? (s.value as { plan?: Plan } | undefined)?.plan : undefined;
		const summary = s.ok
			? stepWords(s)
			: `Not done: ${(s.error?.message ?? s.error?.code ?? 'error').replace(/\b(pl-run|task|ap|rc|t)-[\w-]+/g, 'the plan')}`;
		return {
			type: 'step',
			taskId,
			n: s.n,
			tool: s.tool,
			ok: s.ok,
			summary: summary.slice(0, 400),
			ms: s.ms,
			...(plan ? { href: approvalUrl(plan) } : {}),
			...(s.ok && s.tool === 'commit_order' ? { receipt: receiptView(s) } : {})
		};
	});
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const euros = (c: number | null | undefined) => (c == null ? '' : `€${(c / 100).toFixed(2)}`);

/** A step in the chef's words: what happened, never an id or a count of needs. */
function stepWords(s: StepRecord): string {
	const v = (s.value ?? {}) as Record<string, unknown>;
	const plan = v.plan as Plan | undefined;
	switch (s.tool) {
		case 'search_products':
			return `Found ${plural(((v.products as unknown[]) ?? []).length, 'matching product')}.`;
		case 'quote': {
			const offers = (v.offers ?? []) as { price?: unknown; availability: { kind: string } }[];
			const ok = offers.filter(
				(o) => o.price && !['out', 'blocked', 'undeliverable'].includes(o.availability.kind)
			).length;
			return `Checked price and delivery: ${ok} of ${offers.length} can be bought.`;
		}
		case 'place_order':
		case 'plan_event':
		case 'edit_line':
		case 'find_substitutes': {
			if (!plan) return 'Done.';
			const held = plan.lines.filter((l) => l.state === 'held').length;
			const verb =
				s.tool === 'edit_line'
					? 'Changed the order'
					: s.tool === 'find_substitutes'
						? 'Looked for substitutes'
						: 'Drafted the order';
			return (
				`${verb} for ${dayWords(plan.deliverBy)}: ${plural(plan.lines.length, 'line')}` +
				(plan.totalCents ? `, ${euros(plan.totalCents)}` : '') +
				(held ? `; ${held} ${held === 1 ? 'waits' : 'wait'} for your approval.` : '.')
			);
		}
		case 'get_plan':
			return plan ? `Read the order for ${dayWords(plan.deliverBy)}.` : 'Read the order.';
		case 'commit_order': {
			const n = ((v.committedLineIds as unknown[]) ?? []).length;
			const waiting = ((v.awaitingSupplier as unknown[]) ?? []).length;
			return `Ordered ${plural(n, 'line')} for ${euros(v.totalCents as number)}: ${n - waiting} supplier confirmed, ${waiting} awaiting the supplier.`;
		}
		case 'explain_line':
			return 'Explained a line.';
		default:
			return 'Done.';
	}
}

/** What the message was read as, in plain words. */
function understoodWords(u: { kind: string }, goal: string): string {
	switch (u.kind) {
		case 'order':
			return `Understood an order: ${goal}.`;
		case 'read':
			return 'Understood a question about your order.';
		case 'event':
			return 'Understood an event brief.';
		case 'adjust':
			return 'Understood a change to a dish.';
		case 'repair':
			return 'Understood: find substitutes for what is short.';
		case 'authority':
			return 'Understood a request only a chef can make.';
		case 'smalltalk':
			return 'Understood a greeting.';
		default:
			return 'Could not tell what you need.';
	}
}

function receiptView(s: StepRecord): ReceiptView {
	const v = s.value as ToolOutput<'commit_order'>;
	return {
		receiptId: v.receiptId,
		orderId: v.orderId,
		key: String((s.input as { idempotencyKey?: unknown }).idempotencyKey ?? ''),
		totalCents: v.totalCents,
		lines: v.committedLineIds.length,
		awaiting: v.awaitingSupplier.length
	};
}

function blankTask(deps: ChatDeps, text: string): Task {
	const now = deps.ports.clock.now().toISOString();
	return {
		workspaceId: deps.workspaceId,
		runId: deps.ctx.runId,
		id: freshTaskId(),
		kitchenId: deps.kitchen.id,
		title: text.slice(0, 200),
		createdBy: deps.ctx.actor,
		createdAt: now,
		updatedAt: now,
		version: 0,
		requirement: { goal: text.slice(0, 500) },
		slots: {},
		plans: [],
		runs: [],
		pending: { kind: 'none' },
		state: 'open'
	};
}

export async function* runChatTurn(
	input: ChatTurnInput,
	deps: ChatDeps
): AsyncGenerator<ChatEvent, void, undefined> {
	const store = storeOf(deps.ports);
	const fail = (taskId: string, text: string, state: TaskState = 'failed'): ChatEvent => ({
		type: 'done',
		taskId,
		state,
		text,
		canContinue: false
	});
	const kinds = [input.text !== undefined, input.answer !== undefined, input.continue === true];
	if (kinds.filter(Boolean).length !== 1) {
		yield fail(input.taskId ?? '', 'Send one of text, answer or continue.');
		return;
	}

	// The task this turn is about: the caller's (in this workspace only), the one holding the plan the screen has
	// open, or a new one from the words.
	let task: Task;
	let expected: number | null;
	if (input.taskId) {
		const t = await store.get(deps.workspaceId, input.taskId);
		if (!t) {
			yield fail(input.taskId, `No task ${input.taskId} here.`);
			return;
		}
		task = t;
		expected = t.version;
	} else if (input.planId) {
		// get_plan under the chef's context scopes the plan to this workspace and run.
		const r = await deps.handlers.get_plan(deps.ctx, { planId: input.planId });
		if (!r.ok) {
			yield fail('', "I can't see that plan from here.");
			return;
		}
		const plan = r.value.plan;
		const held = (
			await store.list(deps.workspaceId, { kitchenId: plan.kitchenId, limit: 200 })
		).find((t) => t.plans.some((p) => p.planId === plan.id));
		if (held) {
			task = held;
			expected = held.version;
		} else {
			const text = input.text?.trim() || `Plan ${plan.id}`;
			task = {
				...blankTask(deps, text),
				kitchenId: plan.kitchenId,
				title: `Plan ${plan.id}`,
				requirement: { planId: plan.id },
				plans: [{ planId: plan.id, versionSeen: plan.version, role: 'primary' }]
			};
			expected = null;
		}
	} else {
		const text = input.text?.trim() ?? '';
		if (!text) {
			yield fail('', 'Say what you need, for example "4 kg butter for tomorrow".');
			return;
		}
		task = blankTask(deps, text);
		expected = null;
	}
	// Words that are a request of their own (a product with an amount, or an event brief) start a new task, even while
	// a question is open: they are never squeezed into the open slot, and their quantities are never dropped.
	const words = input.text?.trim();
	const reading = words ? classifyGoal(withoutKitchen(words), deps.today) : null;
	const ruleOwn =
		!!reading &&
		((reading.kind === 'order' && reading.amount) ||
			['event', 'read', 'authority'].includes(reading.kind));
	// A short reply to an open question ("4 kg", "Wednesday") is an answer and needs no model; anything else is read.
	const answering =
		!!words && expected !== null && task.pending.kind === 'clarify' && !ruleOwn && !input.answer;
	const understood =
		words && !answering && !input.answer
			? await understand(words, {
					today: deps.today,
					llm: deps.models?.understand ?? deps.llm ?? null
				})
			: null;
	const u = understood?.understanding;
	const held = expected !== null ? task.plans.find((p) => p.role === 'primary')?.planId : undefined;
	// "Cancel that": the task stops here; orders already placed stay as they are.
	if (expected !== null && words && CANCEL.test(words)) {
		task.state = 'cancelled';
		task.pending = { kind: 'none' };
		task.updatedAt = deps.ports.clock.now().toISOString();
		const saved = await store.put(task, expected);
		yield {
			type: 'done',
			taskId: task.id,
			state: saved.ok ? 'cancelled' : task.state,
			text: saved.ok
				? 'Cancelled this task: nothing more will be ordered for it. Anything already ordered stays as it is.'
				: 'This task changed in another window; reload it and try again.',
			canContinue: false
		};
		return;
	}
	// "Make it 20 kg": the task's own line is resized, on the same plan.
	const resize = held && words ? words.match(RESIZE) : null;
	// "…too", "and 2 l cream": one more product on this task, for the same delivery day unless the words name one.
	const addition = !!held && !!words && !resize && ADDITION.test(words);
	const newRequest =
		!resize &&
		!addition &&
		// A task already in hand, or the plan on screen: a request of its own never joins either. The plan on screen
		// only scopes questions and Continue.
		(expected !== null || (!!input.planId && !input.taskId)) &&
		!!words &&
		!!u &&
		(u.kind === 'event' ||
			(u.kind === 'order' && !!u.items?.some((i) => i.amount !== undefined)) ||
			(reading?.kind === 'order' && reading.amount) ||
			reading?.kind === 'event');
	if (newRequest) {
		task = { ...blankTask(deps, words!), kitchenId: task.kitchenId };
		expected = null;
	}
	// A cancelled task is a fence: no Continue, answer, resize or addition acts on it (a stale button in another tab
	// included); questions still read it, and a request of its own starts a new task above.
	if (
		expected !== null &&
		task.state === 'cancelled' &&
		(input.continue || input.answer || resize || addition || (!!words && u?.kind !== 'read'))
	) {
		yield fail(
			task.id,
			'This task was cancelled, so nothing more is ordered for it. Start a new request to order again.',
			'cancelled'
		);
		return;
	}
	/** The task existed before this turn's words (a follow-up), rather than being started by them. */
	const followUp = expected !== null || (!!input.planId && !newRequest);
	/** A question, an authority request or small talk while a clarify is open is its own goal, not the answer. */
	const ownGoal = !answering;
	// The reading shows when a model made it (or a guard overrode one); the rules' own reading needs no line.
	if (understood && (understood.source !== 'rules' || understood.guard))
		yield {
			type: 'step',
			taskId: task.id,
			n: 0,
			tool: 'understand',
			ok: true,
			summary: understoodWords(u!, understood.goal),
			ms: understood.ms,
			source: understood.source === 'gemini' ? 'live' : 'rules',
			detail:
				(understood.source === 'gemini' ? `via Gemini · ${understood.ms} ms` : 'read by rules') +
				(understood.guard ? ` · ${understood.guard}` : '')
		};
	if (u?.kind === 'smalltalk' && !followUp) {
		yield {
			type: 'done',
			taskId: '',
			state: 'open',
			text: 'Hello! Tell me what you need, for example "4 kg lactose-free butter for Wednesday", or ask "what needs my decision?".',
			canContinue: false
		};
		return;
	}
	const principal = buildRunPrincipal({
		initiator: deps.ctx,
		agentRunId: newAgentRunId(),
		kitchenIds: [task.kitchenId]
	});
	if (!principal) {
		yield fail(task.id, `${deps.ctx.actor.kind} may not start the kitchen agent.`);
		return;
	}
	const agentCtx = principalContext(principal);
	const primary = task.plans.find((p) => p.role === 'primary')?.planId;

	let steps: StepRecord[];
	let clarify: Extract<Task['pending'], { kind: 'clarify' }> | null = null;
	let refusal: string | null = null;
	let planId: string | undefined = primary;
	let run: AgentRun | null = null;

	// The task is saved before anything is bought, so an effect never exists without the task that asked for it, and a
	// concurrent turn on the same task loses here, before it acts.
	{
		const reserved = await store.put(
			{ ...task, state: 'running', updatedAt: deps.ports.clock.now().toISOString() },
			expected
		);
		if (!reserved.ok) {
			yield fail(
				task.id,
				'This task changed in another window; reload it and try again.',
				task.state
			);
			return;
		}
		expected = reserved.value.version;
	}

	if (resize && held) {
		const mismatch: { at?: string } = {};
		steps = await resizeLine(held, resize, mismatch, agentCtx, deps.handlers);
		if (mismatch.at) refusal = mismatch.at;
	} else if (input.continue) {
		if (!task.plans.length) {
			// Still waiting for an answer: ask the open question again rather than act.
			if (task.pending.kind === 'clarify') {
				const q = task.pending;
				yield {
					type: 'clarify',
					taskId: task.id,
					field: q.field,
					question: q.question,
					options: q.options
				};
				yield fail(task.id, q.question, task.state);
				return;
			}
			yield fail(task.id, 'Nothing to continue: this task has no plan yet.', task.state);
			return;
		}
		steps = await continueTask(task, agentCtx, deps.handlers);
	} else {
		// A typed answer to the open question, or words while one is open, fill that field only.
		let goal = !followUp && understood ? understood.goal : String(task.requirement.goal ?? '');
		let goals = [goal];
		let slots: Slots = { ...(task.slots as Slots) };
		const answer =
			input.answer ??
			(followUp && task.pending.kind === 'clarify' && input.text && !ownGoal
				? { field: task.pending.field, value: input.text }
				: undefined);
		if (answer) {
			const field = ClarifyField.safeParse(answer.field);
			if (!field.success) {
				yield fail(task.id, `I can't use an answer for ${String(answer.field)}.`, task.state);
				return;
			}
			const filled = readAnswer(field.data, answer.value);
			if (!Object.keys(filled).length) {
				yield fail(task.id, `That answer for ${field.data} is empty.`, task.state);
				return;
			}
			slots = { ...slots, ...filled };
		} else if (followUp && input.text) {
			// A follow-up question on the task's plan; the task's requirement stays as it was.
			goal = understood?.goal ?? input.text.trim();
			if (addition && held && parseRules(goal, deps.today).deliverBySource === 'default') {
				const r = await deps.handlers.get_plan(deps.ctx, { planId: held });
				if (r.ok) goal = `${goal} ${r.value.plan.deliverBy}`;
			}
			slots = {};
		}

		if (followUp && input.text && !answer) goals = [goal];
		const model =
			deps.planner ??
			((deps.models?.plan ?? deps.llm) ? llmPlanner((deps.models?.plan ?? deps.llm)!) : null);
		const planner = model ? withFallback(model, scriptedPlanner()) : scriptedPlanner();
		steps = [];
		const touched: string[] = [];
		for (const g of goals) {
			const p =
				goals.length > 1
					? buildRunPrincipal({
							initiator: deps.ctx,
							agentRunId: newAgentRunId(),
							kitchenIds: [task.kitchenId]
						})!
					: principal;
			const started = startAgentRun({
				env: deps.env ?? {},
				principal: p,
				goal: g,
				run: ({ signal, onEvent }) =>
					runGoal({
						goal: g,
						principal: p,
						handlers: deps.handlers,
						planner,
						source: contextSource(deps),
						signal,
						onEvent,
						slots,
						planId: primary,
						// A turn plans and drafts; buying waits for the chef's Continue (continue_task).
						withhold: ['commit_order'],
						keyScope: task.id
					})
			});
			if (!started.ok) {
				yield fail(
					task.id,
					'The agent is busy in this workspace; try again in a moment.',
					task.state
				);
				return;
			}
			run = await started.done;
			steps.push(...run.steps);
			task.runs = [
				...task.runs,
				{
					agentRunId: p.agentRunId,
					turn: task.runs.length,
					intent: run.outcome?.intent ?? 'unsupported',
					stopped: run.stopped,
					at: deps.ports.clock.now().toISOString()
				}
			].slice(-20);
			const o = run.outcome;
			if (o?.clarify) {
				// Never ask again for a field the task already holds: a refused answer is cleared first.
				if (o.clarify.field in slots) delete slots[o.clarify.field];
				clarify = { kind: 'clarify', ...o.clarify };
				break;
			} else if (o && !o.planId) refusal ??= o.reason ?? o.nextAction;
			// An order the agent could not place says why (a passed cut-off, nothing in the catalogue), whatever plan
			// the task already has.
			const why = run.plannerSummary?.match(/^not ordered: (.*)$/s)?.[1];
			if (why && !run.steps.some((x) => x.tool === 'place_order' && x.ok))
				refusal = `Not ordered: ${why.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => dayWords(d))}`;
			else if (o?.planId) touched.push(o.planId);
		}
		planId = touched[0] ?? primary;
		for (const id of touched.slice(1))
			if (!task.plans.some((x) => x.planId === id))
				task.plans.push({ planId: id, versionSeen: 0, role: 'touched' });
		if (!(followUp && input.text && !answer)) task.slots = slots;
	}

	for (const e of stepEvents(task.id, steps)) yield e;

	// Plans this task touched: the first one is primary; reads never add plans of their own. An added product ("…too")
	// is the task's newest purchase, so its plan becomes the one the task is about; the earlier stays on the task.
	if (planId && !task.plans.some((p) => p.planId === planId)) {
		const primaryHeld = task.plans.some((p) => p.role === 'primary');
		if (addition)
			task.plans = [
				{ planId, versionSeen: 0, role: 'primary' as const },
				...task.plans.map((p) => ({ ...p, role: 'touched' as const }))
			];
		else if (primaryHeld) task.plans.push({ planId, versionSeen: 0, role: 'touched' });
		else task.plans.unshift({ planId, versionSeen: 0, role: 'primary' });
	}

	let canContinue = false;
	let text: string;
	if (clarify) {
		task.pending = clarify;
		task.state = 'awaiting_clarification';
		yield {
			type: 'clarify',
			taskId: task.id,
			field: clarify.field,
			question: clarify.question,
			options: clarify.options
		};
		text = clarify.question;
	} else if (task.plans.length) {
		const read = await readTask(
			deps.ctx,
			deps.ports,
			deps.handlers,
			task.plans.map((p) => p.planId)
		);
		if (!read.ok) {
			yield fail(task.id, `Could not read the plan: ${read.error.message}`, task.state);
			return;
		}
		// A clarify left over from an earlier turn no longer applies once the task has a plan to act on.
		if (task.pending.kind === 'clarify') task.pending = { kind: 'none' };
		const p = project(task, read.value);
		task = p.task;
		canContinue = p.canContinue;
		const ledger = read.value.ledger;
		const card = decisionEvent(task, read.value);
		if (card) yield card;
		const summary = ledgerSummary(ledger, { deliverBy: read.value.plans[0]?.deliverBy });
		yield { type: 'ledger', taskId: task.id, ledger, summary };
		let answer = summary;
		const explainer = deps.models?.explain ?? deps.llm;
		if (!refusal && explainer) {
			// Gemini words the answer from the ledger; a claim the ledger doesn't back falls back to the template.
			const ex = await explain(
				words ?? (input.continue ? 'What happened with my order?' : 'Where does this stand?'),
				ledger,
				summary,
				{ llm: explainer, deliverBy: read.value.plans[0]?.deliverBy }
			);
			answer = ex.text;
			yield {
				type: 'step',
				taskId: task.id,
				n: steps.length + 1,
				tool: 'explain',
				ok: true,
				summary: "Answered from the order's numbers.",
				ms: ex.ms,
				source: ex.source === 'gemini' ? 'live' : 'rules',
				detail:
					ex.source === 'gemini'
						? `via Gemini · ${ex.ms} ms`
						: `template sentence${ex.rejected ? ` (model reply not used: ${ex.rejected})` : ''}`
			};
		}
		text = refusal ? `${refusal} ${summary}` : answer;
	} else {
		text = refusal ?? run?.outcome?.nextAction ?? 'Nothing was done.';
		// A side question while this task waits for an answer leaves that question open.
		if (followUp && task.pending.kind === 'clarify')
			text = `${text} Still open: ${task.pending.question}`;
		else {
			task.pending = { kind: 'none' };
			task.state = 'open';
		}
	}

	task.updatedAt = deps.ports.clock.now().toISOString();
	let saved = await store.put(task, expected);
	if (!saved.ok) {
		// The effects happened: reconcile onto the stored task (its plans, runs and outcome) rather than lose them.
		const latest = await store.get(deps.workspaceId, task.id);
		if (latest) {
			const plans = [
				...latest.plans,
				...task.plans.filter((p) => !latest.plans.some((x) => x.planId === p.planId))
			];
			saved = await store.put(
				{ ...task, plans, runs: [...latest.runs, ...task.runs.slice(-1)].slice(-20) },
				latest.version
			);
		}
	}
	if (!saved.ok) {
		yield fail(
			task.id,
			'This task changed in another window; reload it and try again.',
			task.state
		);
		return;
	}
	yield { type: 'done', taskId: task.id, state: task.state, text: text.slice(0, 600), canContinue };
}

type TaskRead =
	Awaited<ReturnType<typeof readTask>> extends infer R
		? R extends { ok: true; value: infer V }
			? V
			: never
		: never;

/** The decision card for a task's pending decision, with the Kitchen page's own grouping, names and due time. */
function decisionEvent(task: Task, read: TaskRead): ChatEvent | null {
	if (task.pending.kind !== 'decision') return null;
	const pd = task.pending;
	const plan = read.plans.find((x) => x.id === pd.planId);
	if (!plan) return null;
	const approval = read.approvals.find((x) => x.id === pd.approvalId) ?? null;
	return {
		type: 'decision',
		taskId: task.id,
		approvalId: pd.approvalId,
		planId: pd.planId,
		planVersion: pd.planVersion,
		groups: pd.groups,
		approvalUrl: pd.approvalUrl,
		decisions: decisionsOf(plan, approval),
		names: Object.fromEntries(plan.lines.map((l) => [l.productId, l.productName ?? l.productId])),
		due: decisionsDue(plan, approval)
	};
}

/**
 * A task as it stands now, as the lines a turn ends with (clarify | decision, ledger, done), without running
 * anything: the dock calls it when it opens on a remembered task, so its cards come from the plans as they are, not
 * from what the last turn saw.
 */
export async function taskView(taskId: string, deps: ChatDeps): Promise<ChatEvent[]> {
	const store = storeOf(deps.ports);
	const t = await store.get(deps.workspaceId, taskId);
	if (!t)
		return [
			{ type: 'done', taskId, state: 'failed', text: `No task ${taskId} here.`, canContinue: false }
		];
	const out: ChatEvent[] = [];
	if (t.pending.kind === 'clarify') {
		const q = t.pending;
		out.push({ type: 'clarify', taskId, field: q.field, question: q.question, options: q.options });
		out.push({ type: 'done', taskId, state: t.state, text: q.question, canContinue: false });
		return out;
	}
	if (!t.plans.length)
		return [
			{
				type: 'done',
				taskId,
				state: t.state,
				text: 'Nothing is planned on this task yet.',
				canContinue: false
			}
		];
	const read = await readTask(
		deps.ctx,
		deps.ports,
		deps.handlers,
		t.plans.map((p) => p.planId)
	);
	if (!read.ok)
		return [
			{
				type: 'done',
				taskId,
				state: t.state,
				text: "I can't see this task's plan from here.",
				canContinue: false
			}
		];
	const p = project(t, read.value);
	const card = decisionEvent(p.task, read.value);
	if (card) out.push(card);
	const summary = ledgerSummary(read.value.ledger, { deliverBy: read.value.plans[0]?.deliverBy });
	out.push({ type: 'ledger', taskId, ledger: read.value.ledger, summary });
	out.push({
		type: 'done',
		taskId,
		state: p.task.state,
		text: summary,
		canContinue: p.canContinue
	});
	return out;
}

const CANCEL =
	/^(?:please\s+|ok\s+)?(?:cancel|forget|scrap|drop)\b(?:\s+(?:it|that|this|the order|everything))?\s*[.!]*$|^(?:peru|peruuta|unohda)\b/i;
const ADDITION = /\b(too|also|as well|myös|lisäksi)\b|^\s*(and|ja|plus)\b/i;
const RESIZE =
	/^(?:ok\s+|actually\s+|no\s+|sorry\s+)?(?:make (?:it|that)|change (?:it |that )?to|muuta (?:se )?|tee siitä|vaihda (?:se )?)\s*(\d+(?:[.,]\d+)?)\s*(kg|kiloa?|g|l|litraa?|dl)?\b/iu;

/**
 * "Make it 20 l": the task's one direct need takes the new amount and core re-sizes its lines (edit_line
 * {needId, patch: {amount}}), so demand and purchase stay one. An amount in another dimension (kg for a need in
 * litres) is refused by core with the need's unit, which becomes the question; zero is an amount, not one pack.
 */
async function resizeLine(
	planId: string,
	m: RegExpMatchArray,
	mismatch: { at?: string },
	ctx: CallContext,
	handlers: ToolHandlers
): Promise<StepRecord[]> {
	const steps: StepRecord[] = [];
	const r = await serveTool('get_plan', ctx, { planId }, handlers);
	steps.push({
		n: 1,
		tool: 'get_plan',
		input: { planId },
		why: 'read the need to change',
		ok: r.ok,
		...(r.ok ? { value: r.value } : { error: r.error }),
		ms: 0
	});
	if (!r.ok) return steps;
	const plan = (r.value as ToolOutput<'get_plan'>).plan;
	const direct = plan.needs.filter((n) => !n.dish);
	const need = direct.length === 1 ? direct[0] : undefined;
	if (!need) {
		mismatch.at = 'Which product should change? This order has several; name it with the amount.';
		return steps;
	}
	const word = (m[2] ?? '').toLowerCase();
	let value = Number(m[1].replace(',', '.'));
	let unit: string = need.amount.unit;
	if (/^(kg|kilo)/.test(word)) unit = 'kg';
	else if (word === 'g') {
		unit = 'kg';
		value /= 1000;
	} else if (/^(l|litra)/.test(word)) unit = 'l';
	else if (word === 'dl') {
		unit = 'l';
		value /= 10;
	}
	const input = {
		planId,
		version: plan.version,
		needId: need.id,
		patch: { amount: { value, unit } }
	};
	const e = await serveTool('edit_line', ctx, input, handlers);
	steps.push({
		n: 2,
		tool: 'edit_line',
		input,
		why: `${need.label}: ${value} ${unit}`,
		ok: e.ok,
		...(e.ok ? { value: e.value } : { error: e.error }),
		ms: 0
	});
	if (!e.ok) {
		const needUnit = (e.error.detail as { needUnit?: string } | undefined)?.needUnit;
		const words = (u: string) => (u === 'l' ? 'litres' : u === 'kg' ? 'kilograms' : u);
		mismatch.at = needUnit
			? `That need is in ${words(needUnit)}: how many ${words(needUnit)}?`
			: `Not changed: ${e.error.message}`;
	}
	return steps;
}

/** Collects a turn's lines (tests, callers without streaming). */
export async function chatTurn(input: ChatTurnInput, deps: ChatDeps): Promise<ChatEvent[]> {
	const out: ChatEvent[] = [];
	for await (const e of runChatTurn(input, deps)) out.push(e);
	return out;
}

function contextSource(deps: ChatDeps): ContextSource {
	return {
		kitchens: (ws) => deps.ports.store.kitchens(ws),
		plans: async (ws, run) => Object.values((await deps.ports.store.load(ws, run)).plans),
		today: () => deps.today,
		now: () => deps.ports.clock.now().toISOString(),
		defaultKitchenId: deps.kitchen.id
	};
}

/** FNV-1a, hex: a short stable digest for command keys (not a security hash). */
function digest(x: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < x.length; i++) {
		h ^= x.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * `continue_task`: for every plan of the task, commit exactly the lines that may be bought now (the line views'
 * `committable`: within the mandate, or covered by a chef's live grant), naming them. Each such set is one purchase
 * command with its own key (task, plan, the exact line ids), so a retry of the same command returns its receipt, a
 * set authorised later (another reason group, a grant after a partial commit) is a new command, and no line is
 * bought twice. Nothing committable commits nothing; the ledger and decisions say why.
 */
async function continueTask(
	task: Task,
	ctx: CallContext,
	handlers: ToolHandlers
): Promise<StepRecord[]> {
	const steps: StepRecord[] = [];
	const call = async (tool: ToolName, input: unknown, why: string) => {
		const t0 = performance.now();
		const r = await serveTool(tool, ctx, input, handlers);
		const rec: StepRecord = {
			n: steps.length + 1,
			tool,
			input,
			why,
			ok: r.ok,
			...(r.ok ? { value: r.value } : { error: r.error }),
			ms: Math.round(performance.now() - t0)
		};
		steps.push(rec);
		return r;
	};
	for (const ref of task.plans) {
		const r = await call('get_plan', { planId: ref.planId }, 'read the plan as it is now');
		if (!r.ok) continue;
		const { plan } = r.value as ToolOutput<'get_plan'>;
		const lineIds = plan.lines
			.filter((l) => l.state !== 'committed' && l.view?.committable === true)
			.map((l) => l.id)
			.sort();
		if (!lineIds.length) continue;
		await call(
			'commit_order',
			{
				planId: plan.id,
				version: plan.version,
				lineIds,
				idempotencyKey: `task:${task.id}:commit:${plan.id}:${digest(lineIds.join(','))}`.slice(
					0,
					128
				)
			},
			`commit the ${lineIds.length} line(s) that may be bought now`
		);
	}
	return steps;
}
