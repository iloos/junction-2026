import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { scenarioDate } from '$lib/core/scenario';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import { contextFor } from '$lib/server/auth';
import { readTurnBody } from '$lib/server/chat/body';
import { runChatTurn, type ChatDeps } from '$lib/server/chat/turn';
import { harnessOn, runHarnessTurn } from '$lib/server/chat/harness';
import { acceptMenuAsChef } from '$lib/server/menu/server';
import { visitorWorkspace } from '$lib/server/demo/visitor';
import { session, visitorKey } from '$lib/server/kitchen/live';
import { sid } from '$lib/server/kitchen/sid';
import { onCurrentRun } from '$lib/server/demo/reset';
import { withCallScope } from '$lib/server/scope';
import { createServerPorts } from '$lib/server/store/server-ports';
import { serverTasks } from '$lib/server/tasks/server';
import { handlers as scopedHandlers } from '$lib/server/tools/handlers';
import { json } from '$lib/server/tools/http';
import { errMsg, log } from '$lib/server/obs/log';
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
	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch {
		return bad('body is not JSON');
	}
	const read = readTurnBody(raw);
	if (!read.ok) return bad(read.reason);
	const { input, kitchenId } = read;

	const v = await visitorWorkspace(event, env, dev);
	// The chef's chat acts for this browser's visitor: an owned kitchen takes writes only from its owner (D24).
	const ctx = {
		...(await onCurrentRun(contextFor('chef', 'chef', 'chat', env, v.workspaceId))),
		visitor: visitorKey(v.own)
	};
	const handlers = scopedHandlers;
	const [b, tasks] = await Promise.all([createServerPorts(), serverTasks()]);
	const kitchens = await b.ports.store.kitchens(v.workspaceId);
	// The kitchen the dock names, else the visitor's own, else the one the kitchen screen has selected: never a seed by
	// name (a dock on /request, Ops or /agents sends none).
	const selected = session(sid(event.cookies), v.workspaceId).kitchenId;
	// In a room others share (D24), the chat acts only for this visitor's own store, never a seeded kitchen.
	// The presenter drives the stage's seeded kitchens; everyone else, the shared room included, only their own store.
	const shared = v.kind === 'shared' || v.kind === 'full' || (v.kind === 'stage' && !v.presenter);
	const mine = kitchens.filter((k) => k.owner === ctx.visitor);
	const kitchen = shared
		? (mine.find((k) => k.id === kitchenId) ?? mine[0])
		: (kitchens.find((k) => k.id === kitchenId) ??
			mine[0] ??
			kitchens.find((k) => k.id === selected) ??
			kitchens[0]);
	if (!kitchen && shared)
		return new Response(
			JSON.stringify({
				type: 'done',
				taskId: '',
				state: 'open',
				text: 'Join the room as your own store first: on the Kitchen page, press "Start my store", then tell me what you need.',
				canContinue: false
			}) + '\n',
			{
				headers: {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'cache-control': 'no-store'
				}
			}
		);
	if (!kitchen) return bad('no kitchen in this workspace');
	// Gemini reads, plans and words the chat whenever a provider is configured; the fixture keeps rules and script.
	const live = (env.LLM_PROVIDER ?? 'fixture') !== 'fixture';
	// The new agent per visitor without the env flag: a page opened with ?agent=llm sets a cookie (?agent=off clears it).
	const asked = new URL(event.request.headers.get('referer') ?? 'http://x/').searchParams.get(
		'agent'
	);
	if (asked === 'llm' || asked === 'off')
		event.cookies.set('chat_agent', asked, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24
		});
	const agentOn = harnessOn(env) || (asked ?? event.cookies.get('chat_agent')) === 'llm';
	// Built inside the call scope with no trace of its own: model calls trace into the visitor's drawer and count
	// against the visitor's caps.
	const modelsFor = () => {
		if (!live) return undefined;
		const router = createLlmRouter(env);
		return {
			understand: router.for('chat.understand'),
			explain: router.for('explain'),
			plan: router.for('agent.plan'),
			agent: router.for('chat.agent')
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
					const models = modelsFor();
					const deps: ChatDeps = {
						handlers,
						ctx,
						ports: { ...b.ports, tasks },
						workspaceId: v.workspaceId,
						kitchen,
						today,
						env,
						models,
						// The chef's "plan it" after the menu card is their review of that revision (D13).
						acceptMenu: (id, revision) =>
							acceptMenuAsChef({
								env,
								workspaceId: v.workspaceId,
								visitor: ctx.visitor,
								id,
								revision
							})
					};
					// CHAT_HARNESS=llm: the model leads the turn over the MCP tools; the script answers without a model.
					const turn =
						agentOn && models?.agent
							? runHarnessTurn(input, { ...deps, agent: models.agent })
							: runChatTurn(input, deps);
					for await (const e of turn) push(e);
				} catch (e) {
					// The cause stays in the server log; the chef reads what happened and the way on, never a query.
					log.error('chat.turn.threw', { error: errMsg(e) });
					push({
						type: 'error',
						error: {
							code: 'INTERNAL',
							message:
								'Something went wrong on our side and this answer stopped. What was already done stays; ask again, or open the Kitchen page to see where things stand.'
						}
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
