import type { Plan, ToolName, ToolOutput } from '$lib/core/contracts';
import { ClarifyField, type Task, type TaskState } from '$lib/core/contracts/task';
import type { CallContext, Ports, TaskStore, ToolHandlers } from '$lib/core/ports';
import { runGoal } from '$lib/server/agent';
import type { ContextSource } from '$lib/server/agent/context';
import {
	scriptedPlanner,
	type AgentRun,
	type Planner,
	type StepRecord
} from '$lib/server/agent/loop';
import { nextActionFor } from '$lib/server/agent/next-action';
import { buildRunPrincipal, principalContext } from '$lib/server/agent/principal';
import { newAgentRunId, startAgentRun } from '$lib/server/agent/runs';
import type { Slots } from '$lib/server/agent/types';
import type { Env } from '$lib/server/auth';
import { UNITS } from '$lib/server/request/lexicon';
import { pendingDecision } from '$lib/server/tasks/ledger';
import { ledgerSummary, readTask } from '$lib/server/tasks/outcome';
import { memoryTaskStore } from '$lib/server/tasks/store';
import { approvalUrl, presentMeta } from '$lib/server/tools/present';
import { serveTool } from '$lib/server/tools/serve';
import type { ChatEvent, ChatTurnInput } from '$lib/ui/chat/types';

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
	/** The planner for new goals; the deterministic script by default. */
	planner?: Planner;
}

/** Without a TaskStore on the ports, tasks live in memory per ports object (tests, a store without agent_tasks). */
const fallback = new WeakMap<object, TaskStore>();
function storeOf(ports: ChatDeps['ports']): TaskStore {
	if (ports.tasks) return ports.tasks;
	let s = fallback.get(ports);
	if (!s) fallback.set(ports, (s = memoryTaskStore()));
	return s;
}

const newTaskId = () => `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
		if (!m) return {};
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
			? (presentMeta(s.tool, s.input, s.value)?.summary ?? `${s.tool} done.`)
			: `${s.tool} refused: ${s.error?.message ?? s.error?.code ?? 'error'}`;
		return {
			type: 'step',
			taskId,
			n: s.n,
			tool: s.tool,
			ok: s.ok,
			summary: summary.slice(0, 400),
			...(plan ? { href: approvalUrl(plan) } : {})
		};
	});
}

function blankTask(deps: ChatDeps, text: string): Task {
	const now = deps.ports.clock.now().toISOString();
	return {
		workspaceId: deps.workspaceId,
		runId: deps.ctx.runId,
		id: newTaskId(),
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

	// The task this turn is about: the caller's (in this workspace only), or a new one from the words.
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
	} else {
		const text = input.text?.trim() ?? '';
		if (!text) {
			yield fail('', 'Say what you need, for example "4 kg butter for tomorrow".');
			return;
		}
		task = blankTask(deps, text);
		expected = null;
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

	if (input.continue) {
		if (!primary) {
			yield fail(task.id, 'Nothing to continue: this task has no plan yet.', task.state);
			return;
		}
		steps = await continueTask(task, primary, agentCtx, deps.handlers);
	} else {
		// A typed answer to the open question, or words while one is open, fill that field only.
		let goal = String(task.requirement.goal ?? '');
		let slots: Slots = { ...(task.slots as Slots) };
		const answer =
			input.answer ??
			(input.taskId && task.pending.kind === 'clarify' && input.text
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
		} else if (input.taskId && input.text) {
			// A follow-up question on the task's plan; the task's requirement stays as it was.
			goal = input.text.trim();
			slots = {};
		}

		const started = startAgentRun({
			env: deps.env ?? {},
			principal,
			goal,
			run: ({ signal, onEvent }) =>
				runGoal({
					goal,
					principal,
					handlers: deps.handlers,
					planner: deps.planner ?? scriptedPlanner(),
					source: contextSource(deps),
					signal,
					onEvent,
					slots,
					planId: primary
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
		steps = run.steps;
		const o = run.outcome;
		if (o?.clarify) {
			// Never ask again for a field the task already holds: a refused answer is cleared first.
			if (o.clarify.field in slots) delete slots[o.clarify.field];
			clarify = { kind: 'clarify', ...o.clarify };
		} else if (o && !o.planId) refusal = o.reason ?? o.nextAction;
		planId = o?.planId ?? primary;
		if (!(input.taskId && input.text && !answer)) task.slots = slots;
	}

	for (const e of stepEvents(task.id, steps)) yield e;

	// Plans this task touched: the first one is primary; reads never add plans of their own.
	if (planId && !task.plans.some((p) => p.planId === planId))
		task.plans.push({ planId, versionSeen: 0, role: task.plans.length ? 'touched' : 'primary' });

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
		const { ledger, plans, approvals } = read.value;
		const plan = plans[0];
		task.plans = task.plans.map((p) => ({
			...p,
			versionSeen: plans.find((x) => x.id === p.planId)?.version ?? p.versionSeen
		}));
		task.ledger = ledger;
		task.pending = pendingDecision(plan, approvals);
		if (task.pending.kind === 'decision')
			yield {
				type: 'decision',
				taskId: task.id,
				approvalId: task.pending.approvalId,
				planId: task.pending.planId,
				planVersion: task.pending.planVersion,
				groups: task.pending.groups,
				approvalUrl: task.pending.approvalUrl
			};
		const summary = ledgerSummary(ledger);
		yield { type: 'ledger', taskId: task.id, ledger, summary };
		const next = nextActionFor(plan, { approvalPending: task.pending.kind === 'decision' });
		const granted = approvals.some(
			(a) =>
				a.state === 'granted' &&
				a.planVersion === plan.version &&
				a.lineIds.some((id) => plan.lines.find((l) => l.id === id)?.state !== 'committed')
		);
		canContinue = next.kind === 'commit' || granted;
		task.state =
			task.pending.kind === 'decision'
				? 'awaiting_chef'
				: next.kind === 'await_supplier'
					? 'awaiting_supplier'
					: next.kind === 'done' && ledger.receiptIds.length
						? 'done'
						: 'open';
		text = refusal ? `${refusal} ${summary}` : summary;
	} else {
		task.pending = { kind: 'none' };
		task.state = 'open';
		text = refusal ?? run?.outcome?.nextAction ?? 'Nothing was done.';
	}

	if (run)
		task.runs = [
			...task.runs,
			{
				agentRunId: principal.agentRunId,
				turn: task.runs.length,
				intent: run.outcome?.intent ?? 'unsupported',
				stopped: run.stopped,
				at: deps.ports.clock.now().toISOString()
			}
		].slice(-20);
	task.updatedAt = deps.ports.clock.now().toISOString();
	const saved = await store.put(task, expected);
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

/**
 * `continue_task`: read the task's plan and commit what may be bought now, the lines within the mandate and the lines
 * a chef's live grant covers, under one key per plan version, so a repeated continue never buys twice. Nothing to
 * commit (a voided approval, lines still held) commits nothing; the ledger and a fresh decision say why.
 */
async function continueTask(
	task: Task,
	planId: string,
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
	const r = await call('get_plan', { planId }, 'read the task plan as it is now');
	if (!r.ok) return steps;
	const { plan, approval } = r.value as ToolOutput<'get_plan'>;
	const open = (id: string) => plan.lines.find((l) => l.id === id)?.state !== 'committed';
	const granted =
		approval?.state === 'granted' && approval.planVersion === plan.version
			? approval.lineIds.filter(open)
			: [];
	const eligible = plan.lines.filter(
		(l) => l.state === 'eligible' && l.view?.committable !== false
	);
	if (!granted.length && !eligible.length) return steps;
	await call(
		'commit_order',
		{
			planId: plan.id,
			version: plan.version,
			idempotencyKey: `task:${task.id}:commit:${plan.version}`
		},
		`commit ${eligible.length} line(s) within the mandate and ${granted.length} a chef approved`
	);
	return steps;
}
