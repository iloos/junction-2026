import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { scenarioDate } from '$lib/core/scenario';
import { ClarifyField } from '$lib/core/contracts/task';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { contextFor } from '$lib/server/auth';
import { runChatTurn } from '$lib/server/chat/turn';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { onCurrentRun } from '$lib/server/demo/reset';
import { withCallScope } from '$lib/server/scope';
import { createServerPorts } from '$lib/server/store/server-ports';
import { serverTasks } from '$lib/server/tasks/server';
import { handlers as scopedHandlers } from '$lib/server/tools/handlers';
import { isTaskId } from '$lib/core/contracts/task';
import { json } from '$lib/server/tools/http';
import type { ChatTurnInput } from '$lib/ui/chat/types';
import type { RequestHandler } from './$types';

const bad = (message: string) =>
	json({ error: { code: 'INVALID_INPUT', message, retryable: false } }, 400);

/**
 * POST /api/chat/turn `{taskId?, planId?, kitchenId?, text? | answer:{field,value} | continue:true}` from the Kitchen screen
 * (visitor cookie, D9: the browser's own workspace, as its chef). NDJSON, one ChatEvent per line: step* → clarify |
 * decision? → ledger? → done. The agent acts under the chef's context ∩ its own scopes, so it never approves; the
 * task is written back at the end of the turn, so a reconnect reads the task rather than replaying the stream.
 */
export const POST: RequestHandler = async (event) => {
	let body: Record<string, unknown>;
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch {
		return bad('body is not JSON');
	}
	const input: ChatTurnInput = {};
	if (isTaskId(body.taskId)) input.taskId = body.taskId;
	if (typeof body.planId === 'string' && /^[\w:.-]{1,128}$/.test(body.planId))
		input.planId = body.planId;
	if (typeof body.text === 'string') {
		const text = body.text.trim();
		if (!text || text.length > 500) return bad('text: 1–500 characters');
		input.text = text;
	}
	if (body.answer && typeof body.answer === 'object') {
		const a = body.answer as { field?: unknown; value?: unknown };
		const field = ClarifyField.safeParse(a.field);
		if (!field.success) return bad('answer.field is not a field I ask about');
		input.answer = { field: field.data, value: a.value };
	}
	if (body.continue === true) input.continue = true;

	const v = await visitorWorkspace(event, env, dev);
	const ctx = await onCurrentRun(contextFor('chef', 'chef', 'chat', env, v.workspaceId));
	const handlers = scopedHandlers;
	const [b, tasks] = await Promise.all([createServerPorts(), serverTasks()]);
	const kitchens = await b.ports.store.kitchens(v.workspaceId);
	const kitchen =
		kitchens.find((k) => k.id === body.kitchenId) ??
		kitchens.find((k) => k.id === 'k-hotel') ??
		kitchens[0];
	if (!kitchen) return bad('no kitchen in this workspace');
	// Gemini reads, plans and words the chat whenever a provider is configured; the fixture keeps rules and script.
	const live = (env.LLM_PROVIDER ?? 'fixture') !== 'fixture';
	// Built inside the call scope with no trace of its own: model calls trace into the visitor's drawer and count
	// against the visitor's caps.
	const modelsFor = () => {
		if (!live) return undefined;
		const router = createLlmRouter(env);
		return {
			understand: router.for('chat.understand'),
			explain: router.for('explain'),
			plan: router.for('agent.plan')
		};
	};

	const enc = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let open = true;
			const push = (line: unknown) => {
				if (!open) return;
				try {
					controller.enqueue(enc.encode(JSON.stringify(line) + '\n'));
				} catch {
					open = false;
				}
			};
			// The turn runs in the caller's scope: its run, clock, simulated overlay and outside-call caps.
			void withCallScope(ctx, async () => {
				try {
					const today = scenarioDate(b.ports.clock.now());
					for await (const e of runChatTurn(input, {
						handlers,
						ctx,
						ports: { ...b.ports, tasks },
						workspaceId: v.workspaceId,
						kitchen,
						today,
						env,
						models: modelsFor()
					}))
						push(e);
				} catch (e) {
					push({
						type: 'error',
						error: { code: 'INTERNAL', message: String((e as Error)?.message ?? e).slice(0, 200) }
					});
				} finally {
					if (open) {
						open = false;
						controller.close();
					}
				}
			});
		},
		cancel() {
			// Stop watching only: the turn finishes and writes the task, so the next read catches up.
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
