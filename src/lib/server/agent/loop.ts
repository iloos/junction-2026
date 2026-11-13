import { z } from 'zod';
import {
	toolSchemas,
	type DomainError,
	type ServerEvent,
	type ToolName
} from '$lib/core/contracts';
import type { CallContext, Llm, ToolHandlers } from '$lib/core/ports';
import { traceEvent, type TraceStep } from '$lib/server/adapters/llm/trace';
import { serveTool, toolsFor } from '$lib/server/tools/serve';

/**
 * The routine agent loop: a planner picks the next tool call, the call goes through the same
 * `serveTool` gate as REST and MCP (so the mandate and scopes apply unchanged), and every step is
 * traced. Hard stops: 8 steps (CLAUDE.md rule 6) and a wall-clock deadline.
 */
export const MAX_STEPS = 8;

export type AgentAction =
	{ tool: ToolName; input: unknown; why: string } | { done: true; summary: string };

export interface StepRecord {
	n: number;
	tool: ToolName;
	input: unknown;
	why: string;
	ok: boolean;
	value?: unknown;
	error?: DomainError;
	ms: number;
}

export interface PlannerState {
	goal: string;
	tools: ToolName[];
	history: StepRecord[];
}
export type Planner = (s: PlannerState) => Promise<AgentAction>;

export interface AgentRun {
	steps: StepRecord[];
	summary: string;
	stopped: 'done' | 'max_steps' | 'deadline' | 'planner_error';
}

export async function runAgent(o: {
	goal: string;
	ctx: CallContext;
	handlers: ToolHandlers;
	planner: Planner;
	onEvent?: (e: ServerEvent) => void;
	maxSteps?: number;
	deadlineMs?: number;
}): Promise<AgentRun> {
	const maxSteps = Math.min(o.maxSteps ?? MAX_STEPS, MAX_STEPS);
	const deadline = Date.now() + (o.deadlineMs ?? 60_000);
	const emit = (step: TraceStep, data: Record<string, unknown>) =>
		o.onEvent?.(traceEvent(o.ctx, step, { actor: o.ctx.actor.id, ...data }));
	const tools = toolsFor(o.ctx);
	const steps: StepRecord[] = [];
	const finish = (stopped: AgentRun['stopped'], summary: string): AgentRun => {
		emit('done', { stopped, summary, steps: steps.length });
		return { steps, summary, stopped };
	};

	emit('step', { n: 0, goal: o.goal, tools });
	for (let n = 1; n <= maxSteps; n++) {
		if (Date.now() > deadline)
			return finish('deadline', `stopped at the deadline after ${steps.length} steps`);
		let action: AgentAction;
		try {
			action = await o.planner({ goal: o.goal, tools, history: steps });
		} catch (e) {
			emit('error', { n, error: String((e as Error)?.message ?? e).slice(0, 200) });
			return finish('planner_error', `planner failed at step ${n}`);
		}
		if ('done' in action) return finish('done', action.summary);

		emit('step', { n, tool: action.tool, why: action.why, input: action.input });
		const t0 = performance.now();
		const r = await serveTool(action.tool, o.ctx, action.input, o.handlers);
		const rec: StepRecord = {
			n,
			tool: action.tool,
			input: action.input,
			why: action.why,
			ok: r.ok,
			value: r.ok ? r.value : undefined,
			error: r.ok ? undefined : r.error,
			ms: Math.round(performance.now() - t0)
		};
		steps.push(rec);
		emit('tool', {
			n,
			tool: rec.tool,
			ok: rec.ok,
			ms: rec.ms,
			code: rec.error?.code,
			result: summarize(rec.value)
		});
	}
	return finish('max_steps', `stopped after ${maxSteps} steps`);
}

/** Short, model- and log-friendly digest of a tool result (plans are summarised by line state). */
export function summarize(value: unknown): string {
	if (!value || typeof value !== 'object') return String(value ?? '');
	const v = value as { plan?: PlanLike };
	if (v.plan) {
		const p = v.plan;
		const byState: Record<string, number> = {};
		for (const l of p.lines) byState[l.state] = (byState[l.state] ?? 0) + 1;
		const rest = { ...(value as Record<string, unknown>) };
		delete rest.plan;
		return JSON.stringify({
			plan: {
				id: p.id,
				version: p.version,
				state: p.state,
				totalCents: p.totalCents,
				lines: p.lines.map((l) => ({
					id: l.id,
					productId: l.productId,
					qty: `${l.qty.value} ${l.qty.unit}`,
					state: l.state,
					reasons: l.reasons,
					...(l.substituteFor ? { substituteFor: l.substituteFor } : {})
				})),
				lineStates: byState
			},
			...rest
		}).slice(0, 4000);
	}
	return JSON.stringify(value).slice(0, 2000);
}

interface PlanLike {
	id: string;
	version: number;
	state: string;
	totalCents: number | null;
	lines: {
		id: string;
		productId: string;
		qty: { value: number; unit: string };
		state: string;
		reasons: string[];
		substituteFor?: string;
	}[];
}

/** The newest plan any step returned, for planners that act on it. */
export function latestPlan(history: StepRecord[]): PlanLike | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const p = (history[i].value as { plan?: PlanLike } | undefined)?.plan;
		if (p) return p;
	}
	return null;
}

// ---------- planners ----------

/**
 * Fixture planner: a deterministic script for an event goal, driven by what the tools return, so the
 * demo runs offline. plan_event → a substitute per unorderable line → get_plan → explain one
 * substitute → done. It never approves (it cannot) and never commits: held lines go to the chef.
 */
export function scriptedPlanner(): Planner {
	return async ({ goal, history, tools }) => {
		const last = history.at(-1);
		if (last && !last.ok && last.tool === 'plan_event')
			return { done: true, summary: `could not plan the event: ${last.error?.message}` };
		if (!history.some((h) => h.tool === 'plan_event')) {
			const kitchenId = goal.match(/\bk-[a-z]+\b/)?.[0] ?? 'k-hotel';
			const eventId = /christmas|joulu|xmas/i.test(goal) ? 'event-xmas-140' : 'event-xmas-140';
			return {
				tool: 'plan_event',
				input: { kitchenId, eventId },
				why: `expand the event into needs and lines for ${kitchenId}`
			};
		}
		const plan = latestPlan(history);
		if (!plan) return { done: true, summary: 'no plan came back' };
		const tried = new Set(
			history
				.filter((h) => h.tool === 'find_substitutes')
				.map((h) => (h.input as { lineId: string }).lineId)
		);
		const covered = new Set(plan.lines.map((l) => l.substituteFor).filter(Boolean));
		const out = plan.lines.find(
			(l) => l.state === 'unorderable' && !tried.has(l.id) && !covered.has(l.productId)
		);
		// Leave room for get_plan, explain_line and the final answer.
		if (out && tools.includes('find_substitutes') && history.length < MAX_STEPS - 3)
			return {
				tool: 'find_substitutes',
				input: { planId: plan.id, version: plan.version, lineId: out.id },
				why: `${out.productId} is ${out.reasons.join(', ') || 'unorderable'}: find a substitute`
			};
		if (!history.some((h) => h.tool === 'get_plan'))
			return {
				tool: 'get_plan',
				input: { planId: plan.id },
				why: 'check the plan and its approval'
			};
		const sub = plan.lines.find((l) => l.substituteFor);
		if (sub && !history.some((h) => h.tool === 'explain_line'))
			return {
				tool: 'explain_line',
				input: { planId: plan.id, lineId: sub.id },
				why: `explain why ${sub.productId} replaces ${sub.substituteFor}`
			};
		const held = plan.lines.filter((l) => l.state === 'held');
		const unorderable = plan.lines.filter(
			(l) => l.state === 'unorderable' && !covered.has(l.productId)
		);
		return {
			done: true,
			summary:
				`Plan ${plan.id} v${plan.version}: ${plan.lines.length} lines, total €${((plan.totalCents ?? 0) / 100).toFixed(2)}. ` +
				`${held.length} held for the chef (${[...new Set(held.flatMap((l) => l.reasons))].join(', ') || 'none'}); ` +
				`${unorderable.length} unorderable with no replacement chosen yet.`
		};
	};
}

const ActionSchema = z.union([
	z.object({ done: z.literal(true), summary: z.string() }),
	z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()), why: z.string() })
]);

/** LLM planner: the model sees the goal, the in-scope tools with JSON Schemas and a digest of past steps. */
export function llmPlanner(llm: Llm, opts: { maxTokens?: number } = {}): Planner {
	return async ({ goal, tools, history }) => {
		const catalog = tools.map((t) => ({
			name: t,
			description: toolSchemas[t].description,
			input: z.toJSONSchema(toolSchemas[t].input, { io: 'input' })
		}));
		const past = history.map((h) => ({
			n: h.n,
			tool: h.tool,
			input: h.input,
			ok: h.ok,
			result: h.ok ? summarize(h.value) : h.error
		}));
		const res = await llm.generate({
			system:
				'You are the routine purchasing agent of a professional kitchen. You act only through the tools listed. ' +
				'The mandate is enforced by the tools: held lines wait for the chef, you never approve. ' +
				`You have at most ${MAX_STEPS} tool calls in total. ` +
				'Reply with ONE JSON object and nothing else: {"tool": name, "input": {...}, "why": short reason} ' +
				'or {"done": true, "summary": what was planned, what is held and why}.',
			prompt: JSON.stringify({
				goal,
				tools: catalog,
				steps: past,
				stepsLeft: MAX_STEPS - history.length
			}),
			maxTokens: opts.maxTokens ?? 600,
			json: true
		});
		const text = res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
		const parsed = ActionSchema.parse(JSON.parse(text));
		if ('done' in parsed) return parsed;
		if (!tools.includes(parsed.tool as ToolName))
			throw new Error(`model picked a tool outside its scope: ${parsed.tool}`);
		return { tool: parsed.tool as ToolName, input: parsed.input, why: parsed.why };
	};
}
