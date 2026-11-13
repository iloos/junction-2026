import { json } from '@sveltejs/kit';
import type { ServerEvent } from '$lib/core/contracts';
import { catchUp, subscribe } from '$lib/server/bus';
import type { RequestHandler } from './$types';

/** Read-only until the agent lane's CallContext lands; then the workspace comes from the key. */
const DEFAULT_WORKSPACE = 'ws-demo';
const HEARTBEAT_MS = 15_000;

/**
 * Live op stream (D6): subscribe first, then catch up from `after`, then deliver live, deduplicated by seq.
 * - `GET /api/events?workspace=ws-demo&after=42` → text/event-stream. Each sequenced event has `id: <seq>`,
 *   so EventSource's automatic reconnect resumes from Last-Event-ID.
 * - `…&mode=poll` → JSON `{ events, last }` for clients that fall back to polling.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const workspaceId = url.searchParams.get('workspace') || DEFAULT_WORKSPACE;
	const after = Math.max(
		Number(url.searchParams.get('after')) || 0,
		Number(request.headers.get('last-event-id')) || 0
	);

	if (url.searchParams.get('mode') === 'poll') {
		const events = await catchUp(workspaceId, after);
		const last = events.reduce((m, e) => ('seq' in e ? Math.max(m, e.seq) : m), after);
		return json({ events, last }, { headers: { 'cache-control': 'no-store' } });
	}

	const enc = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let last = after;
			let live = false;
			let closed = false;
			const pending: ServerEvent[] = [];

			const write = (text: string) => {
				if (closed) return;
				try {
					controller.enqueue(enc.encode(text));
				} catch {
					cleanup();
				}
			};
			const send = (e: ServerEvent) => {
				if ('seq' in e) {
					if (e.seq <= last) return;
					last = e.seq;
					write(`id: ${e.seq}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
				} else write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
			};

			const off = subscribe(workspaceId, (e) => (live ? send(e) : pending.push(e)));
			const beat = setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				off();
				clearInterval(beat);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			request.signal.addEventListener('abort', cleanup);

			write(`retry: 2000\n\n`);
			catchUp(workspaceId, after)
				.then((events) => {
					for (const e of events) send(e);
					pending.sort((a, b) => ('seq' in a && 'seq' in b ? a.seq - b.seq : 0));
					for (const e of pending.splice(0)) send(e);
					live = true;
					write(`event: ready\ndata: ${JSON.stringify({ workspaceId, last })}\n\n`);
				})
				.catch((err) => {
					// Catch-up failed (e.g. the op log table is missing); stay subscribed for live events.
					const message = err instanceof Error ? err.message : String(err);
					console.warn(`[events] catch-up failed for ${workspaceId}: ${message}`);
					write(`event: catchup-error\ndata: ${JSON.stringify({ message })}\n\n`);
					for (const e of pending.splice(0)) send(e);
					live = true;
					write(`event: ready\ndata: ${JSON.stringify({ workspaceId, last })}\n\n`);
				});
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
