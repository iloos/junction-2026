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
import { answerInChat } from './question';
import { outsideOptions, outsideSteps } from './outside';
import { readQuestion } from '$lib/server/agent/intents/questions';
import { understand } from './understand';
import { applyBriefAnswers, draftBrief, nextQuestion, toEventBrief } from '$lib/server/menu/brief';
import type { BriefAnswer, BriefField } from '$lib/ui/request/types';
import { eventMatches, SUPPORTED_EVENTS } from '$lib/server/agent/context';
import { coursesIn, guestsIn } from '$lib/server/request/classify';
import type { MenuProposal } from '$lib/core/contracts';
import { project } from '$lib/server/tasks/project';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { approvalUrl } from '$lib/server/tools/present';
import { serveTool } from '$lib/server/tools/serve';
import type { ChatEvent, ChatTurnInput } from '$lib/ui/chat/types';
import { decisionsDue, decisionsOf } from '$lib/ui/decisions';
import type { ReceiptView } from '$lib/ui/Receipt.svelte';
import { interpretDish, type InterpretDish } from './dish';
import { planName } from '$lib/server/agent/plan-name';

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
	/** Reads a dish with a count ("10000 bolognese pasta"); by default ./dish. */
	dish?: InterpretDish;
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
			// A day the kitchen does not receive deliveries is said in words: that is why it waits for sign-off.
			const offDay = plan.lines.some(
				(l) => l.state === 'held' && l.reasons.includes('off_delivery_day')
			);
			const weekday = new Date(`${plan.deliverBy}T12:00:00Z`).toLocaleDateString('en-GB', {
				weekday: 'long',
				timeZone: 'UTC'
			});
			return (
				`${verb} for ${dayWords(plan.deliverBy)}: ${plural(plan.lines.length, 'line')}` +
				(plan.totalCents ? `, ${euros(plan.totalCents)}` : '') +
				(held ? `; ${held} ${held === 1 ? 'waits' : 'wait'} for your approval.` : '.') +
				(offDay
					? ` This kitchen does not receive deliveries on ${weekday}s, so it needs a sign-off or another day.`
					: '')
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
		case 'propose_menu': {
			const dishes = ((v.proposal as { dishes?: unknown[] } | undefined)?.dishes ?? []).length;
			return `Proposed a menu: ${plural(dishes, 'dish', 'dishes')}.`;
		}
		default:
			return 'Done.';
	}
}

/** What the message was read as, in plain words (the dock labels the line "Understood"). */
function understoodWords(u: { kind: string }, goal: string): string {
	switch (u.kind) {
		case 'order':
			return `An order: ${goal}.`;
		case 'read':
			return 'A question about your order.';
		case 'event':
			return 'An event brief.';
		case 'adjust':
			return 'A change to a dish.';
		case 'repair':
			return 'Find substitutes for what is short.';
		case 'authority':
			return 'A request only a chef can make.';
		case 'smalltalk':
			return 'A greeting.';
		default:
			return 'Not clear what you need.';
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

/**
 * A chat turn's lines, as the dock and the route stream them. Every line is in our words (no plan, task or
 * approval ids, no date codes), and every turn ends with something the chef can read and act on: an answer, a
 * question with its answers, a card, or what could not be done and the way on. A turn that would end on its steps
 * alone gets that sentence from its last step, and the miss is logged as a bug.
 */
export async function* runChatTurn(
	turnInput: ChatTurnInput,
	deps: ChatDeps
): AsyncGenerator<ChatEvent, void, undefined> {
	let said = false;
	let taskId = turnInput.taskId ?? '';
	let state: TaskState = 'open';
	let lastStep: Extract<ChatEvent, { type: 'step' }> | null = null;
	/** The words of a closing line the dock would not show (a waiting task's). */
	let hidden = '';
	for await (const raw of turnLines(turnInput, deps)) {
		const e = await scrubEvent(raw, deps);
		if (e.taskId) taskId = e.taskId;
		if (e.type === 'step') lastStep = e;
		if (e.type === 'done') {
			state = e.state;
			hidden = e.text.trim();
		}
		if (
			e.type === 'clarify' ||
			e.type === 'menu' ||
			e.type === 'decision' ||
			(e.type === 'done' && e.state !== 'awaiting_clarification' && e.text.trim())
		)
			said = true;
		yield e;
	}
	if (said) return;
	// A question still open on the task: asked again on its card, with what this turn said (the dock shows a waiting
	// task's words only on the card).
	const open = taskId ? await storeOf(deps.ports).get(deps.workspaceId, taskId) : null;
	if (open?.pending.kind === 'clarify') {
		const q = open.pending;
		const asked =
			hidden && !hidden.includes(q.question) ? `${hidden} ${q.question}` : hidden || q.question;
		yield { type: 'clarify', taskId, field: q.field, question: asked, options: q.options };
		yield {
			type: 'done',
			taskId,
			state: 'awaiting_clarification',
			text: asked,
			canContinue: false
		};
		return;
	}
	console.error('[chat] a turn ended without a message; said from its last step', {
		taskId,
		lastStep: lastStep?.tool ?? null
	});
	yield {
		type: 'done',
		taskId,
		state: state === 'awaiting_clarification' ? 'open' : state,
		text:
			hidden ||
			(lastStep
				? `I couldn't finish this: ${lastStep.summary.replace(/^Not done: /, '')} Tell me the product and the amount again, or ask what is open.`
				: 'I could not act on that. Tell me what you need, for example "4 kg lactose-free butter for Friday", or ask what is open.'),
		canContinue: false
	};
}

/** Our words for every line a chef reads: ids become what they are, date codes become days. */
async function scrubEvent(e: ChatEvent, deps: ChatDeps): Promise<ChatEvent> {
	const words = async (t: string) =>
		(await scrub(t, deps)).replace(/\b(20\d{2}-\d{2}-\d{2})(T[\d:.]+Z?)?\b/g, (_, d: string) =>
			dayWords(d)
		);
	switch (e.type) {
		case 'step':
			return { ...e, summary: await words(e.summary) };
		case 'clarify':
			return {
				...e,
				question: await words(e.question),
				options: await Promise.all(
					e.options.map(async (o) => ({ ...o, label: await words(o.label) }))
				)
			};
		case 'done':
			return { ...e, text: await words(e.text) };
		default:
			return e;
	}
}

async function* turnLines(
	turnInput: ChatTurnInput,
	deps: ChatDeps
): AsyncGenerator<ChatEvent, void, undefined> {
	let input = turnInput;
	const store = storeOf(deps.ports);
	const fail = (taskId: string, text: string, state: TaskState = 'failed'): ChatEvent => ({
		type: 'done',
		taskId,
		state,
		text,
		canContinue: false
	});
	// The answer to "What would you like to do?": a question reads, the others say what to type.
	if (input.answer?.field === 'intent') {
		const v = String(input.answer.value);
		if (v === 'check')
			input = { ...input, answer: undefined, text: 'What still needs my decision?' };
		else {
			yield {
				type: 'done',
				taskId: input.taskId ?? '',
				state: 'open',
				text:
					v === 'event'
						? 'Describe the event: guests, the day and anything to avoid, for example "Dinner for 40 on Saturday, 4 courses, vegetarian:6".'
						: v === 'product'
							? 'Ask about one product, for example "Is the Valio whipping cream recalled?", "Where is the butter from?" or "What is my cap?".'
							: 'Tell me what and how much, for example "4 kg lactose-free butter for Friday".',
				canContinue: false
			};
			return;
		}
	}
	// "Go ahead", "plan it", "jatka" on a task is Continue (for an event task: plan the reviewed menu).
	if ((input.taskId || input.planId) && input.text && GO_AHEAD.test(input.text.trim()))
		input = { ...input, text: undefined, continue: true };
	const kinds = [input.text !== undefined, input.answer !== undefined, input.continue === true];
	if (kinds.filter(Boolean).length !== 1) {
		yield fail(input.taskId ?? '', 'Send one of text, answer or continue.');
		return;
	}

	// The task this turn is about: the caller's (in this workspace only), the one holding the plan the screen has
	// open, or a new one from the words.
	let task: Task;
	let expected: number | null;
	let remembered: Task | null = null;
	if (input.taskId) {
		const t = await store.get(deps.workspaceId, input.taskId);
		if (!t) {
			yield fail(input.taskId, `No task ${input.taskId} here.`);
			return;
		}
		remembered = t;
	}
	// The plan on screen wins over a remembered task that has nothing of its own (no plan, no open question): the
	// dock answers for what the chef is looking at.
	const idle =
		!!remembered &&
		!!input.planId &&
		!remembered.plans.length &&
		remembered.pending.kind !== 'clarify';
	if (remembered && !idle) {
		task = remembered;
		expected = remembered.version;
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
			const text = input.text?.trim() || planName(plan, SUPPORTED_EVENTS);
			task = {
				...blankTask(deps, text),
				kitchenId: plan.kitchenId,
				title: planName(plan, SUPPORTED_EVENTS),
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
	// The answer to "10,000 portions of pasta bolognese?": plan the dish as an event, or buy that many packs.
	const dishAsked =
		expected !== null &&
		task.pending.kind === 'clarify' &&
		task.pending.field === 'dish' &&
		task.pending.options.some((o) => o.value === 'as-dish');
	const said = input.text?.trim() ?? '';
	const dishChoice = !dishAsked
		? null
		: input.answer?.field === 'dish'
			? String(input.answer.value)
			: YES.test(said)
				? 'as-dish'
				: NO_PACKS.test(said)
					? 'as-packs'
					: null;
	if (dishChoice === 'as-dish' || dishChoice === 'as-packs') {
		const goal = String(task.requirement.goal ?? '');
		const d = await (deps.dish ?? interpretDish)(goal, { today: deps.today });
		task.pending = { kind: 'none' };
		if (d && dishChoice === 'as-dish') {
			// The dish is planned like an event brief: guests, day and style are asked, then a menu is proposed. The
			// chef's words stay the goal; the brief is ours.
			task.requirement = {
				...task.requirement,
				kind: 'event',
				brief: `${d.dish[0].toUpperCase()}${d.dish.slice(1)} for ${d.portions} guests`
			};
			input = { ...input, text: undefined, answer: undefined, continue: undefined };
		} else {
			// Packs of a product named like the dish: the routine order path, with the unit given.
			task.requirement = {
				...task.requirement,
				brief: d ? `${d.portions} packs of ${d.dish}` : goal
			};
			input = { ...input, text: undefined, answer: { field: 'unit', value: 'sales' } };
		}
	}
	// Words that are a request of their own (a product with an amount, or an event brief) start a new task, even while
	// a question is open: they are never squeezed into the open slot, and their quantities are never dropped.
	const words = input.text?.trim();
	const reading = words ? classifyGoal(withoutKitchen(words), deps.today) : null;
	// A dish with a bare count ("10000 bolognese pasta") is a request of its own, even while a question is open.
	const dishWords =
		words && !input.answer
			? await (deps.dish ?? interpretDish)(withoutKitchen(words), { today: deps.today })
			: null;
	const ruleOwn =
		!!dishWords ||
		(!!reading &&
			((reading.kind === 'order' && reading.amount) ||
				['event', 'read', 'authority'].includes(reading.kind)));
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
	// "What?" after a question or a refusal: say again what the last turn needs, never a generic menu.
	if (expected !== null && words && WHAT.test(words)) {
		const goal = String(task.requirement.brief ?? task.requirement.goal ?? '');
		if (task.pending.kind === 'clarify') {
			const q = task.pending;
			const d =
				q.field === 'dish'
					? await (deps.dish ?? interpretDish)(String(task.requirement.goal ?? ''), {
							today: deps.today
						})
					: null;
			yield {
				type: 'clarify',
				taskId: task.id,
				field: q.field,
				question: d
					? `I couldn't find a product called “${productWords(String(task.requirement.goal ?? ''), d)}”. Did you mean ${d.portions.toLocaleString('en-US')} portions of the dish ${d.dish}?`
					: `I need one more thing for “${goal.slice(0, 80)}”: ${q.question}`,
				options: q.options
			};
			yield {
				type: 'done',
				taskId: task.id,
				state: task.state,
				text: q.question,
				canContinue: false
			};
			return;
		}
		if (!task.plans.length) {
			yield {
				type: 'done',
				taskId: task.id,
				state: task.state,
				text: `I could not act on “${goal.slice(0, 80)}”: I need the product and an amount with a unit, for example "4 kg lactose-free butter for Friday", or a dish or event to plan, for example "Dinner for 40 on Saturday".`,
				canContinue: false
			};
			return;
		}
	}
	// "Make it 20 kg": the task's own line is resized, on the same plan. An answer to the amount question ("Use
	// 20.62 kg", or a number typed in the need's unit) resizes the same way; "keep" leaves it as it is.
	const amountAnswer =
		held && task.pending.kind === 'clarify' && task.pending.field === 'qty' && task.plans.length
			? String((input.answer?.field === 'qty' ? input.answer.value : undefined) ?? words ?? '')
			: '';
	if (amountAnswer && /^(keep|no\b)/i.test(amountAnswer.trim())) {
		task.pending = { kind: 'none' };
		const saved = await store.put(
			{ ...task, updatedAt: deps.ports.clock.now().toISOString() },
			expected
		);
		yield {
			type: 'done',
			taskId: task.id,
			state: task.state,
			text: saved.ok
				? 'Kept the amount as it was.'
				: 'This task changed in another window; reload it and try again.',
			canContinue: false
		};
		return;
	}
	const resize =
		held && words && !amountAnswer
			? words.match(RESIZE)
			: amountAnswer
				? `make it ${amountAnswer.replace(/^(use|make it)\s+/i, '')}`.match(RESIZE)
				: null;
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
	// A dish with a bare count ("10000 bolognese pasta") is asked about before anything is searched: portions of the
	// dish to plan, or packs of a product. It is a request of its own.
	const dish =
		words &&
		!answering &&
		!input.answer &&
		!resize &&
		!addition &&
		u?.kind !== 'event' &&
		u?.kind !== 'read' &&
		reading?.kind !== 'event' &&
		reading?.kind !== 'read' &&
		!(u?.items ?? []).some((i) => i.unit)
			? dishWords
			: null;
	if (newRequest || (dish && expected !== null)) {
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
	// A new task is titled by what it asks for, in our words ("4 kg lactose-free butter Wednesday").
	if (expected === null && understood && !input.planId) {
		const g = understood.goal.trim();
		task.title = (g[0]?.toUpperCase() ?? '') + g.slice(1, 200);
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
	// A question about the mandate or one product ("what's my cap?", "is the cream recalled?") is answered read-only
	// (chat/question.ts), ahead of the plan read and the "what would you like to do?" chips. Nothing is saved.
	const question =
		words && !answering && !input.answer && !resize && !addition
			? readQuestion(withoutKitchen(words))
			: null;
	if (question) {
		yield* answerInChat(question, deps, {
			taskId: expected !== null ? task.id : '',
			state: expected !== null ? task.state : 'open',
			kitchenId: task.kitchenId
		});
		return;
	}
	// Words that ask for nothing we can do ("??"): one short question with four answers, never a plan dump.
	if (
		words &&
		!answering &&
		!dish &&
		(u?.kind === 'other' || (!u && reading?.kind === 'other') || !/[\p{L}\d]/u.test(words)) &&
		task.pending.kind !== 'clarify'
	) {
		yield {
			type: 'clarify',
			taskId: expected !== null ? task.id : '',
			field: 'intent',
			question: 'What would you like to do?',
			options: [
				{ label: 'Order something', value: 'order' },
				{ label: 'Plan an event', value: 'event' },
				{ label: "Check what's open", value: 'check' },
				{ label: 'Ask about a product', value: 'product' }
			]
		};
		yield {
			type: 'done',
			taskId: expected !== null ? task.id : '',
			// Awaiting the answer: the dock enables the chips and shows the question once, on the card.
			state: 'awaiting_clarification',
			text: 'What would you like to do?',
			canContinue: false
		};
		return;
	}
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
	/** This turn answered the open question: it is closed, whatever the run did next. */
	let answered = false;
	let planId: string | undefined = primary;
	let run: AgentRun | null = null;
	/** A menu proposal shown this turn (the event flow). */
	let menuCard: Extract<ChatEvent, { type: 'menu' }> | null = null;
	/** What a Continue did: bought something, or found nothing newly authorised. */
	let continued: 'ordered' | 'nothing' | 'failed' | null = null;
	// The decision and numbers as they stood before this turn: a card or ledger line is shown again only when it
	// changed, or when the chef asks.
	const before = { decision: task.shown?.decision ?? null, ledger: task.shown?.ledger ?? null };
	const asked = u?.kind === 'read';
	// An event brief ("7-course meal for 3") is the chat's own flow: ask what the brief lacks, propose a menu, and plan
	// it once a chef has reviewed it. The seeded buffet keeps the agent's own plan_event path.
	const eventFlow =
		!dish &&
		(task.requirement.kind === 'event' ||
			(!followUp &&
				!!words &&
				(u?.kind === 'event' || reading?.kind === 'event') &&
				!isSeededEvent(words)));
	if (eventFlow && task.requirement.kind !== 'event')
		task.requirement = { ...task.requirement, kind: 'event' };

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

	if (dish) {
		steps = [];
		const n = dish.portions.toLocaleString('en-US');
		clarify = {
			kind: 'clarify',
			field: 'dish',
			question:
				dish.question ?? `That reads like a dish, not a product: ${n} portions of ${dish.dish}?`,
			options: [
				{ label: 'Yes, plan it as a dish', value: 'as-dish' },
				{ label: `No, ${n} packs`, value: 'as-packs' }
			]
		};
	} else if (eventFlow) {
		const r = await eventTurn(task, input, words, agentCtx, deps);
		steps = r.steps;
		clarify = r.clarify;
		refusal = r.say;
		menuCard = r.menu;
		if (r.planId) planId = r.planId;
	} else if (resize && held) {
		const mismatch: Mismatch = {};
		steps = await resizeLine(held, resize, mismatch, agentCtx, deps.handlers);
		if (mismatch.ask && mismatch.at)
			clarify = {
				kind: 'clarify',
				field: 'qty',
				question: mismatch.at,
				options: mismatch.options ?? []
			};
		else if (mismatch.at) refusal = mismatch.at;
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
		// The stored task, unprojected: whether it was cancelled is a stored fact.
		const rawStore = (
			'inner' in store ? (store as { inner: TaskStore }).inner : store
		) as TaskStore;
		const cancelled = async () =>
			(await rawStore.get(deps.workspaceId, task.id))?.state === 'cancelled';
		steps = await continueTask(
			task,
			{
				...agentCtx,
				// Checked by commit_order under the workspace lock, right before the order is written.
				// The read goes through the purchase's own transaction where the store has one.
				fence: async (tx) =>
					(
						rawStore.getIn
							? (await rawStore.getIn(tx, deps.workspaceId, task.id))?.state === 'cancelled'
							: await cancelled()
					)
						? 'the task was cancelled; nothing was ordered'
						: null
			},
			deps.handlers,
			async () => !(await cancelled())
		);
		const commits = steps.filter((x) => x.tool === 'commit_order');
		continued = commits.some((x) => x.ok)
			? 'ordered'
			: commits.some((x) => !x.ok)
				? 'failed'
				: 'nothing';
		if (continued === 'failed') {
			const e = commits.find((x) => !x.ok)!.error;
			refusal =
				e?.code === 'TERMS_CHANGED'
					? 'Nothing was ordered: prices or terms changed since the plan was quoted, so it was quoted again. Check the new terms (and any decision they need), then Continue to order on them.'
					: /cancelled/.test(e?.message ?? '')
						? 'This task was cancelled while I was working, so nothing was ordered.'
						: `Nothing was ordered: ${e?.message ?? 'the order was refused'}.`;
		}
	} else {
		// A typed answer to the open question, or words while one is open, fill that field only.
		let goal =
			!followUp && understood
				? understood.goal
				: String(task.requirement.brief ?? task.requirement.goal ?? '');
		let goals = [goal];
		let slots: Slots = { ...(task.slots as Slots) };
		const answer =
			input.answer ??
			(followUp && task.pending.kind === 'clarify' && input.text && !ownGoal
				? { field: task.pending.field, value: input.text }
				: undefined);
		if (answer) {
			answered = true;
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
			// A product left out of a placed order (nothing could be bought as asked) is said in the answer.
			const left = run.steps
				.find((x) => x.tool === 'place_order' && x.ok)
				?.why.match(/; not ordered: (.*)$/)?.[1];
			if (left) refusal = `Not ordered: ${left}.`;
			if (why && !run.steps.some((x) => x.tool === 'place_order' && x.ok)) {
				// Nothing in the catalogue by that name: said with what was searched, and the ways on.
				const none = why.match(/no catalogue product matches "([^"]+)"/)?.[1];
				refusal = none
					? `I couldn't find “${none}” in Valio's catalogue, so there is nothing to buy yet. Try another name for it (the brand, or the Finnish word), name a similar product, or describe the dish and I will plan it.`
					: `Not ordered: ${why.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => dayWords(d))}`;
			} else if (o?.planId) touched.push(o.planId);
		}
		// Words read as an order that the request parser could not turn into a product and an amount: say so, and the
		// way on, never "not recognised" after the reading said order.
		if (refusal?.startsWith('I did not recognise') && (u?.kind === 'order' || dishChoice))
			refusal = `I read this as an order for “${goal.slice(0, 80)}”, but could not match it to a product and an amount I can buy. Name the product with an amount and unit, for example "4 kg lactose-free butter for Friday", or describe a dish or event and I will plan it.`;
		planId = touched[0] ?? primary;
		for (const id of touched.slice(1))
			if (!task.plans.some((x) => x.planId === id))
				task.plans.push({ planId: id, versionSeen: 0, role: 'touched' });
		if (!(followUp && input.text && !answer)) task.slots = slots;
	}

	for (const e of stepEvents(task.id, steps)) yield e;
	// Needs a shortage repair left unresolved: options outside the catalogue, for the chef's information only.
	const outside =
		run?.outcome?.intent === 'shortage_repair'
			? await outsideOptions(run.outcome.unresolvedNeeds, agentCtx, deps.handlers)
			: null;
	if (outside) for (const e of outsideSteps(task.id, steps.length, outside)) yield e;

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
		const sameDecision =
			task.pending.kind === 'decision' &&
			before.decision === `${task.pending.approvalId}:${task.pending.planVersion}`;
		const ledgerSig = `${ledger.decisionsLeft}:${ledger.receiptIds.join()}:${JSON.stringify(ledger.needs.map((n) => [n.needId, n.plannedKnown.value, n.supplierConfirmed.value, n.unresolved.value]))}`;
		const sameLedger = before.ledger === ledgerSig;
		task.shown = {
			...(task.pending.kind === 'decision'
				? { decision: `${task.pending.approvalId}:${task.pending.planVersion}` }
				: {}),
			ledger: ledgerSig
		};
		if (card && (asked || !sameDecision)) yield card;
		const summary = ledgerSummary(ledger, { deliverBy: read.value.plans[0]?.deliverBy });
		if (asked || !sameLedger || !sameDecision)
			yield { type: 'ledger', taskId: task.id, title: task.title, ledger, summary };
		let answer = summary;
		const explainer = deps.models?.explain ?? deps.llm;
		if (!refusal && explainer && !continued) {
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
		if (continued === 'ordered') text = orderedWords(read.value.plans, ledger.decisionsLeft);
		if (continued === 'nothing')
			text = ledger.decisionsLeft
				? `Nothing new to order: ${ledger.decisionsLeft} ${ledger.decisionsLeft === 1 ? 'decision is' : 'decisions are'} still waiting for you.`
				: 'Nothing new to order.';
	} else if (menuCard) {
		yield menuCard;
		task.pending = { kind: 'none' };
		task.state = 'awaiting_chef';
		text = refusal ?? '';
	} else {
		text = refusal ?? run?.outcome?.nextAction ?? 'Nothing was done.';
		// A side question while this task waits for an answer leaves that question open.
		// The dock shows a waiting task's answer on its question card, so the card is sent again with both.
		if (followUp && !answered && task.pending.kind === 'clarify') {
			const q = task.pending;
			text = `${text} Still open: ${q.question}`;
			yield {
				type: 'clarify',
				taskId: task.id,
				field: q.field,
				question: (await scrub(text, deps)).slice(0, 600),
				options: q.options
			};
		} else {
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
			// A cancellation that landed meanwhile stands: the merged task keeps its terminal state.
			const terminal = latest.state === 'cancelled';
			if (terminal) task.state = 'cancelled';
			saved = await store.put(
				{
					...task,
					plans,
					runs: [...latest.runs, ...task.runs.slice(-1)].slice(-20),
					...(terminal ? { state: 'cancelled' as const, pending: { kind: 'none' as const } } : {})
				},
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
	yield {
		type: 'done',
		taskId: task.id,
		title: task.title,
		state: task.state,
		text:
			(await scrub(text, deps)).slice(0, 600) +
			(outside?.text
				? `

${outside.text}`
				: ''),
		canContinue,
		...(outside?.sources.length ? { sources: outside.sources } : {})
	};
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
 * The dock opening on a page's plan: the task that holds it (its cards as they are now), or none yet, with the plan's
 * name for the header. A remembered task about something else is never shown here.
 */
export async function planView(
	planId: string,
	deps: ChatDeps
): Promise<{ taskId: string | null; title: string; events: ChatEvent[] }> {
	const r = await deps.handlers.get_plan(deps.ctx, { planId });
	if (!r.ok) return { taskId: null, title: '', events: [] };
	const plan = r.value.plan;
	const held = (
		await storeOf(deps.ports).list(deps.workspaceId, { kitchenId: plan.kitchenId, limit: 200 })
	).find((t) => t.plans.some((p) => p.planId === plan.id));
	const title = held?.title || planName(plan, SUPPORTED_EVENTS);
	return { taskId: held?.id ?? null, title, events: held ? await taskView(held.id, deps) : [] };
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
	// Nothing planned and nothing asked: there is nothing to show (the next turn says what it does).
	if (!t.plans.length) return [];
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
	out.push({ type: 'ledger', taskId, title: t.title, ledger: read.value.ledger, summary });
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
/** A bare "what?": the chef did not follow the last turn. */
const WHAT =
	/^(what|what\?+|huh|sorry|pardon|eh|mitä|häh|what do you mean|what does that mean)\W*$/i;
const YES = /^(y|yes|yeah|yep|sure|ok|kyllä|joo|plan it|as a dish)\b/i;
const NO_PACKS = /^(no|nope|ei)\W*$|\bpacks?\b/i;

/** The product words of a dish request, without the count and the ordering words ("bolongese pasta"). */
function productWords(goal: string, d: { dish: string }): string {
	const w = goal
		.replace(/^.*\b(order|buy|need|want|tilaa)\b\s*/i, '')
		.replace(/[\d\s,.]*\d\s*/, '')
		.trim();
	return (w || d.dish).slice(0, 60);
}
const ADDITION = /\b(too|also|as well|myös|lisäksi)\b|^\s*(and|ja|plus)\b/i;
const RESIZE =
	/^(?:ok\s+|actually\s+|no\s+|sorry\s+)?(?:make (?:it|that)|change (?:it |that )?to|muuta (?:se )?|tee siitä|vaihda (?:se )?)\s*(\d+(?:[.,]\d+)?)\s*(kg|kiloa?|g|l|litraa?|dl)?\b/iu;

/** A resize the turn could not apply: what to say, and whether it is a question about the amount (with chips). */
interface Mismatch {
	at?: string;
	ask?: boolean;
	options?: { label: string; value: string }[];
}

/**
 * "Make it 20 l": the task's one direct need takes the new amount and core re-sizes its lines (edit_line
 * {needId, patch: {amount}}), so demand and purchase stay one. An amount in another dimension (kg for a need in
 * litres) is refused by core with the need's unit, which becomes the question; zero is an amount, not one pack.
 */
async function resizeLine(
	planId: string,
	m: RegExpMatchArray,
	mismatch: Mismatch,
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
		const d = (e.error.detail ?? {}) as {
			needUnit?: string;
			converted?: { value: number; unit: string };
			source?: string;
		};
		const words = (u: string) => (u === 'l' ? 'litres' : u === 'kg' ? 'kilograms' : u);
		if (d.converted) {
			// Valio's own pack data gives a density: ask to confirm the converted amount, never apply it silently.
			const amount = `${Math.round(d.converted.value * 100) / 100} ${d.converted.unit}`;
			mismatch.at = `That's about ${amount} by Valio's own pack data (${d.source}). Use ${amount}?`;
			mismatch.options = [
				{ label: `Use ${amount}`, value: amount },
				{ label: 'No, keep it', value: 'keep' }
			];
		} else if (d.needUnit)
			mismatch.at = `That need is in ${words(d.needUnit)}: how many ${words(d.needUnit)}?`;
		else mismatch.at = `Not changed: ${e.error.message}`;
		if (d.needUnit) mismatch.ask = true;
	}
	return steps;
}

/** The seeded Christmas buffet: its own words, with its guest count or none, and no courses asked for. */
function isSeededEvent(words: string): boolean {
	return SUPPORTED_EVENTS.some((e) => {
		if (!eventMatches(words, e.title, e.id)) return false;
		const guests = guestsIn(words);
		return (guests === null || guests === 140) && coursesIn(words) === null;
	});
}

const BRIEF_FIELDS: readonly BriefField[] = [
	'guests',
	'date',
	'serviceStyle',
	'courses',
	'dietary',
	'budget'
];

/** The brief's answered fields from the task's slots, as /request's brief answers. */
function briefAnswers(task: Task): BriefAnswer[] {
	const slots = task.slots as Record<string, unknown>;
	return BRIEF_FIELDS.filter((f) => slots[f] !== undefined).map((f) => ({
		id: `brief.${f}` as const,
		value: slots[f] as BriefAnswer['value']
	}));
}

/** A chip's value (JSON) or typed words, as the brief field's value. */
function briefValue(field: BriefField, raw: unknown): BriefAnswer['value'] | null {
	if (typeof raw === 'string') {
		try {
			const v = JSON.parse(raw) as unknown;
			if (typeof v === 'number' || typeof v === 'string' || Array.isArray(v))
				return v as BriefAnswer['value'];
		} catch {
			/* typed words */
		}
		const t = raw.trim();
		if (!t) return null;
		if (field === 'guests' || field === 'courses' || field === 'budget') {
			const n = Number(t.replace(/[^\d.,]/g, '').replace(',', '.'));
			return Number.isFinite(n) && n >= 0 ? n : null;
		}
		if (field === 'dietary') return /^(none|no|ei)$/i.test(t) ? [] : t.split(/\s*,\s*/);
		return t;
	}
	if (typeof raw === 'number' || Array.isArray(raw)) return raw as BriefAnswer['value'];
	return null;
}

/** Words that mean Continue on a task in hand. */
const GO_AHEAD =
	/^(ok(ay)?[,!.]?\s+|yes[,!.]?\s+|kyllä[,!.]?\s+)?(go ahead|continue|proceed|order it|do it|plan it|plan the menu|jatka|tilaa se|suunnittele)[.!]?$/i;

/** "Plan it", "go ahead", "suunnittele": plan the reviewed menu. */
const PLAN_IT = /\b(plan( it| the menu)?|go ahead|order it|let'?s go|suunnittele|tee se|tilaa)\b/i;

/**
 * One turn of the event flow. Fills the brief from answers (one question at a time, /request's own questions and
 * chips), proposes a menu once the brief is complete (propose_menu, stored as the task's proposal), and plans the
 * menu a chef has reviewed when asked (plan_event{proposal}). The model never reviews a menu; the chef does on /request.
 */
async function eventTurn(
	task: Task,
	input: ChatTurnInput,
	words: string | undefined,
	ctx: CallContext,
	deps: ChatDeps
): Promise<{
	steps: StepRecord[];
	clarify: Extract<Task['pending'], { kind: 'clarify' }> | null;
	say: string | null;
	menu: Extract<ChatEvent, { type: 'menu' }> | null;
	planId?: string;
}> {
	const steps: StepRecord[] = [];
	const call = async (tool: ToolName, inp: unknown, why: string) => {
		const t0 = performance.now();
		const r = await serveTool(tool, ctx, inp, deps.handlers);
		steps.push({
			n: steps.length + 1,
			tool,
			input: inp,
			why,
			ok: r.ok,
			...(r.ok ? { value: r.value } : { error: r.error }),
			ms: Math.round(performance.now() - t0)
		});
		return r;
	};
	const goal = String(task.requirement.brief ?? task.requirement.goal ?? '');
	const slots = task.slots as Record<string, unknown>;

	// An answer to the open brief question, as a chip or typed.
	const open = task.pending.kind === 'clarify' ? task.pending.field : null;
	const field = (input.answer?.field ?? (words ? open : null)) as BriefField | null;
	if (field && BRIEF_FIELDS.includes(field)) {
		const v = briefValue(field, input.answer ? input.answer.value : words);
		if (v !== null) slots[field] = v;
	}
	task.slots = slots as Task['slots'];

	// A menu already proposed: plan it when asked, else say where it is reviewed.
	if (task.proposal) {
		if (input.continue || (words && PLAN_IT.test(words))) {
			const r = await call(
				'plan_event',
				{ kitchenId: task.kitchenId, proposal: task.proposal },
				'plan the reviewed menu'
			);
			if (r.ok)
				return {
					steps,
					clarify: null,
					say: null,
					menu: null,
					planId: (r.value as ToolOutput<'plan_event'>).plan.id
				};
			return {
				steps,
				clarify: null,
				menu: null,
				say: /review/i.test(r.error.message)
					? 'The menu needs your review first: open it, accept it, then say "plan it".'
					: `Not planned: ${r.error.message}`
			};
		}
		return {
			steps,
			clarify: null,
			menu: null,
			say: 'Review the menu (link above); once you accept it, say "plan it" and I will plan the order.'
		};
	}

	const draft = applyBriefAnswers(draftBrief(goal, deps.today), briefAnswers(task), deps.today);
	// The title says what the event is as far as the brief knows it ("Menu for 3, 7 courses").
	task.title = [
		draft.guests ? `Menu for ${draft.guests}` : 'Event menu',
		draft.courses ? `${draft.courses} courses` : '',
		draft.date ? dayWords(draft.date) : ''
	]
		.filter(Boolean)
		.join(', ');
	const q = nextQuestion(draft, deps.today);
	if (q) {
		const options = q.chips.slice(0, 6).map((c) => ({
			// A day in words ("Fri 11 Dec"), never a date code.
			label: c.label.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => dayWords(d)).slice(0, 80),
			value: JSON.stringify(c.answer.value).slice(0, 200)
		}));
		return {
			steps,
			clarify: {
				kind: 'clarify',
				field: q.field as ClarifyField,
				question: q.text.slice(0, 300),
				options
			},
			say: null,
			menu: null
		};
	}
	const brief = toEventBrief(draft, goal);
	if (!brief)
		return {
			steps,
			clarify: null,
			menu: null,
			say: 'I could not read the brief; describe the event again.'
		};
	const r = await call(
		'propose_menu',
		{ kitchenId: task.kitchenId, brief },
		'propose a menu for the brief'
	);
	if (!r.ok) return { steps, clarify: null, menu: null, say: `No menu yet: ${r.error.message}` };
	const proposal = (r.value as { proposal: MenuProposal }).proposal;
	task.proposal = { id: proposal.id, revision: proposal.revision };
	const unresolved = proposal.dishes
		.flatMap((x) => x.ingredients)
		.filter((i) => i.unresolved !== undefined).length;
	const menu: Extract<ChatEvent, { type: 'menu' }> = {
		type: 'menu',
		taskId: task.id,
		proposalId: proposal.id,
		revision: proposal.revision,
		title: brief.title,
		guests: brief.guests,
		date: brief.date,
		dishes: proposal.dishes.map((x) => ({
			name: x.name,
			...(x.course ? { course: x.course } : {})
		})),
		...(brief.budgetCents ? { budgetCents: brief.budgetCents } : {}),
		unresolved,
		reviewed: proposal.status !== 'proposed',
		reviewUrl: `/request?menu=${encodeURIComponent(proposal.id)}&rev=${proposal.revision}`
	};
	return {
		steps,
		clarify: null,
		menu,
		say:
			`A menu for ${brief.guests} guests on ${dayWords(brief.date)}: ${proposal.dishes.length} dishes` +
			(unresolved ? `, ${unresolved} ingredients without a product yet` : '') +
			'. Amounts are estimates. Review it, then say "plan it".'
	};
}

/**
 * What a Continue bought, per dish in plain words ("Ordered: cured salmon 9.8 kg, rice porridge (rice 1.68 kg, milk
 * 10.5 l)."), then what still waits ("Waiting on your decision: 14 lines in 2 decisions.").
 */
export function orderedWords(plans: Plan[], decisionsLeft: number): string {
	const amount = (l: Plan['lines'][number]) => {
		const p = l.view?.physical;
		return p ? `${Math.round(p.value * 100) / 100} ${p.unit}` : `${l.qty.value} ${l.qty.unit}`;
	};
	const plain = (label: string) =>
		(label.match(/\(([^)]+)\)/)?.[1] ?? label.split(' · ')[0]).trim();
	const short = (name: string | undefined, id: string) =>
		(name ?? id).split(/\s+/).slice(0, 3).join(' ').toLowerCase();
	const parts: string[] = [];
	let held = 0;
	for (const plan of plans) {
		held += plan.lines.filter((l) => l.state === 'held').length;
		for (const need of plan.needs) {
			const bought = plan.lines.filter((l) => l.needId === need.id && l.state === 'committed');
			if (!bought.length) continue;
			parts.push(
				!need.dish && bought.length === 1
					? `${short(bought[0].productName, bought[0].productId)} ${amount(bought[0])}`
					: bought.length === 1
						? `${plain(need.label)} ${amount(bought[0])}`
						: `${plain(need.label)} (${bought.map((l) => `${short(l.productName, l.productId)} ${amount(l)}`).join(', ')})`
			);
		}
		const loose = plan.lines.filter((l) => !l.needId && l.state === 'committed');
		for (const l of loose) parts.push(`${short(l.productName, l.productId)} ${amount(l)}`);
	}
	const ordered = parts.length
		? `Ordered: ${parts.slice(0, 12).join(', ')}${parts.length > 12 ? ', …' : ''}.`
		: '';
	const waiting = decisionsLeft
		? ` Waiting on your decision: ${held} ${held === 1 ? 'line' : 'lines'} in ${decisionsLeft} ${decisionsLeft === 1 ? 'decision' : 'decisions'}.`
		: '';
	return (ordered + waiting).trim() || 'Nothing was ordered.';
}

/** Our words without ids: plan, task and approval ids read as "the order", kitchen ids as the kitchen's name. */
async function scrub(text: string, deps: ChatDeps): Promise<string> {
	let out = text
		.replace(/\b[Pp]lan (pl-run|pl)-[\w-]+( v\d+)?( \(k-[a-z]+\))?/g, 'the order')
		.replace(/\b(pl-run|task|ap|rc)-[\w-]+( v\d+)?/g, 'the order');
	if (/\bk-[a-z]+\b/.test(out)) {
		const kitchens = await deps.ports.store.kitchens(deps.workspaceId);
		for (const k of kitchens) out = out.replaceAll(k.id, k.name);
	}
	return out;
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
	handlers: ToolHandlers,
	/** Re-reads the task right before a purchase: false when it was cancelled meanwhile (another tab, another turn). */
	stillOpen: () => Promise<boolean> = async () => true
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
		// The cancellation fence: a task cancelled while this turn ran buys nothing more.
		if (!(await stillOpen())) {
			steps.push({
				n: steps.length + 1,
				tool: 'commit_order',
				input: { planId: plan.id },
				why: 'the task was cancelled',
				ok: false,
				error: {
					code: 'FORBIDDEN',
					message: 'the task was cancelled; nothing was ordered',
					retryable: false
				},
				ms: 0,
				refused: true
			});
			break;
		}
		await call(
			'commit_order',
			{
				planId: plan.id,
				version: plan.version,
				lineIds,
				// One purchase command: task + plan + version + accepted terms + the exact lines. A retry of it replays its
				// receipt; changed terms or another line set is a new command, never blocked by an earlier failed one.
				idempotencyKey: `task:${task.id}:commit:${digest(
					[plan.id, plan.version, plan.termsHash ?? '', lineIds.join(',')].join('|')
				)}`
			},
			`commit the ${lineIds.length} line(s) that may be bought now`
		);
	}
	return steps;
}
