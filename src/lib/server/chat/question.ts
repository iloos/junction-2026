/**
 * A chef's question about the mandate or one product, answered in the dock: read-only tools through the gate
 * (agent/intents/questions.ts holds the allowlist), under the chef's context ∩ the agent's scopes like every chat turn.
 * Nothing is planned, ordered or saved: the turn yields its steps and one answer with its sources, and the task (if
 * any) stays as it was.
 */
import type { TaskState } from '$lib/core/contracts/task';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { answerQuestion, type Question } from '$lib/server/agent/intents/questions';
import { buildRunPrincipal, principalContext } from '$lib/server/agent/principal';
import { newAgentRunId } from '$lib/server/agent/runs';
import type { ChatEvent } from '$lib/ui/chat/types';

export async function* answerInChat(
	q: Question,
	deps: { ctx: CallContext; handlers: ToolHandlers },
	at: { taskId: string; state: TaskState; kitchenId: string }
): AsyncGenerator<ChatEvent> {
	const principal = buildRunPrincipal({
		initiator: deps.ctx,
		agentRunId: newAgentRunId(),
		kitchenIds: [at.kitchenId]
	});
	if (!principal) {
		yield {
			type: 'done',
			taskId: at.taskId,
			state: at.state,
			text: `${deps.ctx.actor.kind} may not start the kitchen agent.`,
			canContinue: false
		};
		return;
	}
	const t0 = Date.now();
	const a = await answerQuestion(q, principalContext(principal), deps.handlers, {
		kitchenId: at.kitchenId
	});
	const ms = Date.now() - t0;
	let n = 0;
	for (const s of a.steps)
		yield {
			type: 'step',
			taskId: at.taskId,
			n: ++n,
			tool: s.tool,
			ok: s.ok,
			summary: s.summary,
			source: s.source,
			ms
		};
	// More than one product matched: the chef picks before anything is answered.
	if (a.choices?.length)
		yield {
			type: 'clarify',
			taskId: at.taskId,
			field: 'product',
			question: 'Which one?',
			options: a.choices
		};
	yield {
		type: 'done',
		taskId: at.taskId,
		state: at.state,
		text: a.text,
		canContinue: false,
		...(a.sources.length ? { sources: a.sources } : {})
	};
}
