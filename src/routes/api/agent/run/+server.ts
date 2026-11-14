import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { buildRunPrincipal } from '$lib/server/agent/principal';
import { newAgentRunId, startAgentRun } from '$lib/server/agent/runs';
import { json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent/run `{ goal? }` with a Bearer key → NDJSON: one `trace` ServerEvent per line, then
 * `{ "kind": "result", "id", "run": AgentRun }` (the run carries its GoalOutcome). Traces also go to the
 * bus, so /ops shows the run live. 409 when a run is already going in this workspace (one at a time per workspace).
 *
 * Starting the agent delegates purchasing work, so it needs `agent:run` (chef keys only). The run acts as
 * the routine agent with the intersection of the starter's and the agent's scopes, and every op it writes
 * names the starter. Closing the response only stops watching; POST /api/agent/run/<id>/cancel stops the agent.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	const principal = buildRunPrincipal({ initiator: ctx, agentRunId: newAgentRunId() });
	if (!principal)
		return json(
			{
				error: {
					code: 'FORBIDDEN',
					message: `${ctx.actor.kind} may not start the kitchen agent (needs agent:run)`,
					retryable: false
				}
			},
			403
		);

	let goal: string | undefined;
	try {
		const text = await request.text();
		const body = text ? (JSON.parse(text) as { goal?: unknown }) : {};
		if (body.goal !== undefined && typeof body.goal !== 'string') throw new Error('goal');
		goal = body.goal as string | undefined;
	} catch {
		return json(
			{
				error: {
					code: 'INVALID_INPUT',
					message: 'body must be JSON { goal?: string }',
					retryable: false
				}
			},
			400
		);
	}

	const enc = new TextEncoder();
	const early: unknown[] = [];
	let push: (line: unknown) => void = (line) => early.push(line);
	const started = startAgentRun({ goal, env, principal, onEvent: (e) => push(e) });
	if (!started.ok)
		return json(
			{
				error: {
					code: 'DUPLICATE',
					message:
						started.busyWith === 'capacity'
							? 'the agent is at capacity; try again shortly'
							: `agent run ${started.busyWith} is in progress`,
					retryable: true
				}
			},
			409
		);

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let open = true;
			push = (line) => {
				if (!open) return;
				try {
					controller.enqueue(enc.encode(JSON.stringify(line) + '\n'));
				} catch {
					open = false;
				}
			};
			for (const line of early.splice(0)) push(line);
			started.done
				.then((run) => push({ kind: 'result', id: started.id, run }))
				.catch((e) =>
					push({ kind: 'error', error: { code: 'INTERNAL', message: String(e?.message ?? e) } })
				)
				.finally(() => {
					if (!open) return;
					open = false;
					controller.close();
				});
		},
		cancel() {
			// Stop watching, not stop agent: the run keeps going (its ops are real). Use .../cancel to stop it.
			push = () => {};
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
