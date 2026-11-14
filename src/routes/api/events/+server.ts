import { json } from '@sveltejs/kit';
import type { ServerEvent } from '$lib/core/contracts';
import {
	catchUp,
	isMemoryOnly,
	startStress,
	STRESS_WORKSPACE,
	subscribe,
	SYNTH_WORKSPACE
} from '$lib/server/bus';
import { JUDGES_WORKSPACE } from '$lib/server/auth';
import { currentRun, currentRunStartedAt } from '$lib/server/demo/run';
import { DEMO_WORKSPACE, ensureRunLoaded } from '$lib/server/demo/reset';
import { ownWorkspace } from '$lib/server/demo/visitor';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';

/**
 * Production serves the public rooms, and a visitor sandbox only to the browser whose signed cookie names it
 * (D9): another visitor's id in the query reads nothing.
 */
const PUBLIC_WORKSPACES = new Set([DEMO_WORKSPACE, JUDGES_WORKSPACE, SYNTH_WORKSPACE]);

/** Catch-up reads pages of PAGE events until a short page, at most MAX_PAGES (then live takes over). */
const PAGE = 1000;
const MAX_PAGES = 20;

const HEARTBEAT_MS = 15_000;
const RUN_CHECK_MS = 3_000;

/**
 * Live op stream (D6): subscribe first, then catch up from `after`, then deliver live, deduplicated by seq.
 * Read-only; without `workspace` it streams the browser's own sandbox (or the stage when it has none).
 * - `GET /api/events?workspace=ws-demo&after=42` → text/event-stream. Each sequenced event has `id: <seq>`,
 *   so EventSource's automatic reconnect resumes from Last-Event-ID.
 * - `…&mode=poll` → JSON `{ events, last }` for clients that fall back to polling.
 */
/** The highest seq among `events`, or `from` if none is higher. */
const highestSeq = (events: ServerEvent[], from: number) =>
	events.reduce((m, e) => ('seq' in e ? Math.max(m, e.seq) : m), from);

export const GET: RequestHandler = async ({ url, request, cookies }) => {
	const own = ownWorkspace(cookies, env);
	const workspaceId = url.searchParams.get('workspace') || own || DEMO_WORKSPACE;
	const readable = PUBLIC_WORKSPACES.has(workspaceId) || workspaceId === own;
	if (!dev && !readable)
		return json(
			{ error: { code: 'FORBIDDEN', message: 'unknown workspace', retryable: false } },
			{ status: 403 }
		);
	const after = Math.max(
		Number(url.searchParams.get('after')) || 0,
		Number(request.headers.get('last-event-id')) || 0
	);

	// Dev-only load test: a fresh stream of `copies` interleaved synthetic runs.
	if (dev && workspaceId === STRESS_WORKSPACE && after === 0)
		startStress(Math.min(Math.max(Number(url.searchParams.get('copies')) || 10, 1), 100));

	// Memory-only workspaces carry their own runs; every other workspace shows only its current run.
	const followRun = !isMemoryOnly(workspaceId);
	let runId = followRun ? await ensureRunLoaded(workspaceId) : undefined;

	/** Everything after `from` in the followed run, page by page. */
	const catchUpAll = async (from: number) => {
		const out: ServerEvent[] = [];
		let cursor = from;
		for (let i = 0; i < MAX_PAGES; i++) {
			const page = await catchUp(workspaceId, cursor, PAGE, runId);
			out.push(...page);
			const top = highestSeq(page, cursor);
			if (page.length < PAGE || top === cursor) break;
			cursor = top;
		}
		return out;
	};
	const startedAt = () => (followRun ? currentRunStartedAt(workspaceId) : undefined);

	if (url.searchParams.get('mode') === 'poll') {
		const events = await catchUpAll(after);
		const last = highestSeq(events, after);
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
			const beat = setInterval(
				() =>
					write(`: ping

`),
				HEARTBEAT_MS
			);
			// A reset elsewhere: tell the client to clear the stage for the new run.
			const runCheck = setInterval(() => {
				if (!followRun || currentRun(workspaceId) === runId) return;
				runId = currentRun(workspaceId);
				write(`event: run
data: ${JSON.stringify({ workspaceId, runId, startedAt: startedAt() })}

`);
			}, RUN_CHECK_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				off();
				clearInterval(beat);
				clearInterval(runCheck);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			request.signal.addEventListener('abort', cleanup);

			const ready = () =>
				write(
					`event: ready\ndata: ${JSON.stringify({ workspaceId, runId, last, startedAt: startedAt() })}\n\n`
				);

			write(`retry: 2000\n\n`);
			catchUpAll(after)
				.then((events) => {
					for (const e of events) send(e);
					pending.sort((a, b) => ('seq' in a && 'seq' in b ? a.seq - b.seq : 0));
					for (const e of pending.splice(0)) send(e);
					live = true;
					ready();
				})
				.catch((err) => {
					// Catch-up failed (e.g. the op log table is missing); stay subscribed for live events.
					const message = err instanceof Error ? err.message : String(err);
					console.warn(`[events] catch-up failed for ${workspaceId}: ${message}`);
					write(`event: catchup-error\ndata: ${JSON.stringify({ message })}\n\n`);
					for (const e of pending.splice(0)) send(e);
					live = true;
					ready();
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
