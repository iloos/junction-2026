import type { ServerEvent } from '$lib/core/contracts';
import type { ToolHandlers } from '$lib/core/ports';
import { createLlm } from '$lib/server/adapters/llm';
import { traceEvent } from '$lib/server/adapters/llm/trace';
import { contextFor, type Env } from '$lib/server/auth';
import { handlers as defaultHandlers } from '$lib/server/tools/handlers';
import { llmPlanner, runAgent, scriptedPlanner, type AgentRun } from './loop';

export { runAgent, scriptedPlanner, llmPlanner, MAX_STEPS, type AgentRun } from './loop';

/**
 * Runs the routine agent as `kitchen_agent` for the demo workspace. `LLM_PROVIDER=fixture` (the default)
 * plays the deterministic script with no network; otherwise the configured model plans each step,
 * and its calls are traced through the same `onEvent` callback as the tool steps.
 */
export async function runRoutineAgent(o: {
	goal: string;
	env: Env;
	onEvent?: (e: ServerEvent) => void;
	handlers?: ToolHandlers;
	deadlineMs?: number;
}): Promise<AgentRun> {
	const ctx = contextFor('kitchen_agent', 'routine-agent', 'agent', o.env);
	const fixture = (o.env.LLM_PROVIDER ?? 'fixture') === 'fixture';
	const llm = createLlm(o.env, (step, data) => o.onEvent?.(traceEvent(ctx, step, data)));
	return runAgent({
		goal: o.goal,
		ctx,
		handlers: o.handlers ?? defaultHandlers,
		planner: fixture ? scriptedPlanner() : llmPlanner(llm),
		onEvent: o.onEvent,
		deadlineMs: o.deadlineMs
	});
}
