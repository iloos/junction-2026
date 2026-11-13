import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveRequest } from '$lib/server/auth';
import { startAgentRun } from '$lib/server/bus/agent-runs';
import { json, unauthorized } from '$lib/server/tools/http';
import type { RequestHandler } from './$types';

/** Actors allowed to start the kitchen's own agent. Outside agents use the tools, not our loop. */
const MAY_RUN = new Set(['chef', 'kitchen_agent', 'approver']);

/**
 * POST /api/agent/run `{ goal? }` with a Bearer key → NDJSON: one `trace` ServerEvent per line, then
 * `{ "kind": "result", "run": AgentRun }`. Traces also go to the bus, so /ops shows the run live.
 * 409 when a run is already going (one at a time per process).
 */
export const POST: RequestHandler = async ({ request }) => {
	const ctx = resolveRequest(request, env, { dev, via: 'rest' });
	if (!ctx) return unauthorized();
	if (!MAY_RUN.has(ctx.actor.kind))
		return json(
			{
				error: {
					code: 'FORBIDDEN',
					message: 'this key may not run the kitchen agent',
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
	const started = startAgentRun({ goal, env, onEvent: (e) => push(e) });
	if (!started.ok)
		return json(
			{
				error: {
					code: 'DUPLICATE',
					message: `agent run ${started.busyWith} is in progress`,
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
			// The run keeps going (its ops are real); only this response stops.
			push = () => {};
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
