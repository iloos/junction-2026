import type { Plan, ServerEvent, ToolOutput } from '$lib/core/contracts';
import type { Llm, ToolHandlers } from '$lib/core/ports';
import { createDecide } from '$lib/server/adapters/decide';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { traceEvent } from '$lib/server/adapters/llm/trace';
import { contextFor, type Env } from '$lib/server/auth';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers as defaultHandlers } from '$lib/server/tools/handlers';
import { serveTool, toolsFor } from '$lib/server/tools/serve';
import { bootstrapContext, type ContextSource } from './context';
import { resolveIntent } from './intent';
import { llmPlanner, runAgent, scriptedPlanner, type AgentRun, type Planner } from './loop';
import { computeOutcome, unsupportedOutcome } from './outcome';
import { buildRunPrincipal, principalContext, PRESENTER } from './principal';
import { outcomeReviewer } from './review';
import { TOOLS_BY_INTENT, type RunPrincipal } from './types';
import { reviewEnabled, ReviewBudget, type ReviewDeps } from '$lib/server/review';

export { runAgent, scriptedPlanner, llmPlanner, MAX_STEPS, type AgentRun } from './loop';
export type { GoalOutcome, RunPrincipal } from './types';

/**
 * One goal, end to end: context bootstrap → deterministic intent → (unsupported: stop, no model call) →
 * loop with the intent's tools under the principal's intersected scopes and kitchen grant → GoalOutcome
 * from the plan as the store holds it. The outcome rides on the final `done` trace event.
 */
export async function runGoal(o: {
	goal: string;
	principal: RunPrincipal;
	handlers: ToolHandlers;
	planner: Planner;
	source: ContextSource;
	onEvent?: (e: ServerEvent) => void;
	signal?: AbortSignal;
	deadlineMs?: number;
	maxSteps?: number;
	/** Review the planner's summary against the outcome (REVIEW flag); `llm` rewrites once on revise. */
	review?: { deps: ReviewDeps; llm?: Llm };
}): Promise<AgentRun> {
	const p = o.principal;
	const ctx = principalContext(p);
	const context = await bootstrapContext(o.source, p, o.goal);
	const intent = resolveIntent(o.goal, context);
	const intro = { intent, initiatedBy: p.initiatedBy, agentRun: p.agentRunId };
	const left = Date.parse(p.expiresAt) - Date.now();
	const deadlineMs = Math.max(0, Math.min(o.deadlineMs ?? 60_000, left));

	if (intent.kind === 'unsupported') {
		const outcome = unsupportedOutcome(intent.reason, intent.clarify);
		const summary = `${outcome.status}: ${intent.reason}`;
		const emit = (step: 'step' | 'done', data: Record<string, unknown>) =>
			o.onEvent?.(traceEvent(ctx, step, { actor: ctx.actor.id, ...data }));
		emit('step', { n: 0, goal: o.goal, tools: [], ...intro });
		emit('done', { stopped: 'unsupported', summary, steps: 0, outcome });
		return { steps: [], summary, stopped: 'unsupported', outcome };
	}

	return runAgent({
		goal: o.goal,
		ctx,
		handlers: o.handlers,
		planner: o.planner,
		onEvent: o.onEvent,
		signal: o.signal,
		deadlineMs,
		maxSteps: o.maxSteps,
		intent,
		context,
		allowedTools: TOOLS_BY_INTENT[intent.kind].filter((t) => toolsFor(ctx).includes(t)),
		kitchenIds: p.kitchenIds,
		intro,
		...(o.review
			? {
					reviewSummary: outcomeReviewer({
						goal: o.goal,
						deps: {
							...o.review.deps,
							trace: (step, data) =>
								o.onEvent?.(traceEvent(ctx, step, { actor: ctx.actor.id, ...data }))
						},
						llm: o.review.llm,
						signal: o.signal
					})
				}
			: {}),
		finalize: async ({ steps, stopped }) => {
			// The plan this run worked on: the newest one a tool returned, else the intent's.
			const planned = steps
				.map((s) => (s.ok ? (s.value as { plan?: Plan } | undefined)?.plan : undefined))
				.filter((x): x is Plan => !!x)
				.at(-1);
			const planId = planned?.id ?? ('planId' in intent ? intent.planId : null);
			const early = stopped === 'done' ? undefined : `run stopped: ${stopped}`;
			if (!planId)
				return computeOutcome({
					intent: intent.kind,
					plan: null,
					approval: null,
					reason: early ?? 'no plan was created'
				});
			// The outcome is read through the same gate, as a read, after the loop.
			const r = await serveTool('get_plan', ctx, { planId }, o.handlers);
			if (!r.ok)
				return computeOutcome({
					intent: intent.kind,
					plan: null,
					approval: null,
					reason: r.error.message
				});
			const v = r.value as ToolOutput<'get_plan'>;
			return computeOutcome({
				intent: intent.kind,
				plan: v.plan,
				approval: v.approval,
				reason: early
			});
		}
	});
}

/** The server's context source: kitchens and plans from the process store, today from its clock. */
export async function serverContextSource(): Promise<ContextSource> {
	const b = await createServerPorts();
	return {
		kitchens: (ws) => b.ports.store.kitchens(ws),
		plans: async (ws, run) => Object.values((await b.ports.store.load(ws, run)).plans),
		// The /request page's kitchen, so "4 kg butter tomorrow" works the same here.
		defaultKitchenId: 'k-hotel',
		today: () =>
			new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(b.ports.clock.now())
	};
}

/**
 * Runs the routine agent for the demo workspace. Without a principal it runs as the /ops presenter
 * button (a labelled system initiator). The deterministic script plans unless `AGENT_PLANNER=llm` and a
 * model is configured (`LLM_PROVIDER` not fixture); then the model plans each step, traced through the same
 * `onEvent` callback as the tool steps. Gemini decisions and request parsing follow `LLM_PROVIDER` alone.
 */
export async function runRoutineAgent(o: {
	goal: string;
	env: Env;
	onEvent?: (e: ServerEvent) => void;
	handlers?: ToolHandlers;
	deadlineMs?: number;
	signal?: AbortSignal;
	principal?: RunPrincipal;
	source?: ContextSource;
}): Promise<AgentRun> {
	const principal =
		o.principal ??
		buildRunPrincipal({
			initiator: contextFor(PRESENTER.kind, PRESENTER.id, 'ops', o.env),
			agentRunId: `agent-${Date.now().toString(36)}`,
			presenter: true
		})!;
	const ctx = principalContext(principal);
	const fixture = (o.env.LLM_PROVIDER ?? 'fixture') === 'fixture' || o.env.AGENT_PLANNER !== 'llm';
	const router = createLlmRouter(o.env, (step, data) => o.onEvent?.(traceEvent(ctx, step, data)));
	const llm = router.for('agent.plan');
	return runGoal({
		goal: o.goal,
		principal,
		handlers: o.handlers ?? defaultHandlers,
		planner: fixture ? scriptedPlanner() : llmPlanner(llm),
		source: o.source ?? (await serverContextSource()),
		onEvent: o.onEvent,
		signal: o.signal,
		deadlineMs: o.deadlineMs,
		// Shipped dark: REVIEW=1 turns the outcome-text review on (model scoring only off fixture).
		...(reviewEnabled(o.env)
			? {
					review: {
						deps: {
							decide: createDecide({
								env: o.env,
								replayPath: 'src/lib/server/adapters/decide/replay.json'
							}),
							budget: new ReviewBudget(3)
						},
						...(fixture ? {} : { llm: router.for('agent.review_rewrite') })
					}
				}
			: {})
	});
}
