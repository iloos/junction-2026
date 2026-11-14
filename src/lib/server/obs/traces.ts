/**
 * Persisted traces: every model, outside and tool call becomes one `traces` row, so the trace drawer and Ops keep
 * their history across a restart. Writes are queued and flushed in batches off the request path: `recordTrace`
 * never awaits, never throws, and drops the oldest rows if the database stays away. Rows older than RETAIN_MS go
 * on a flush at most every PRUNE_EVERY_MS.
 */
import { randomUUID } from 'node:crypto';
import { currentScope } from '../external/scope';
import { currentRequest } from './context';
import { errMsg, log } from './log';
import { capJson, scrubString } from './redact';
import { createTraceStore, type TraceRow, type TraceStore } from './trace-store';

export const RETAIN_MS = 7 * 24 * 60 * 60_000;
export const PRUNE_EVERY_MS = 10 * 60_000;
export const FLUSH_MS = 2_000;
export const BATCH = 50;
export const MAX_QUEUE = 2_000;
export const MAX_DATA_BYTES = 4_096;

/** Keys that become columns; the rest of the trace payload goes to `data`. */
const COLUMN_KEYS = new Set([
	'source',
	'api',
	'model',
	'tool',
	'tokensIn',
	'tokensOut',
	'latencyMs',
	'cache',
	'ok',
	'error',
	'costUnits',
	'workspaceId',
	'runId',
	'actor',
	'via',
	'at'
]);

const str = (v: unknown, max = 200) =>
	typeof v === 'string' && v ? scrubString(v, max) : undefined;
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** One row from a trace step and its payload, with the request and call scope filled in. */
export function toTraceRow(
	step: string,
	data: Record<string, unknown>,
	at: Date = new Date()
): TraceRow {
	const req = currentRequest();
	const scope = currentScope();
	const actor =
		(data.actor && typeof data.actor === 'object'
			? (data.actor as { kind?: string; id?: string })
			: undefined) ??
		req?.actor ??
		scope?.actor;
	const actorId = typeof data.actor === 'string' ? data.actor : actor?.id;
	const error = str(data.error, 300) ?? null;
	const rest: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) if (!COLUMN_KEYS.has(k)) rest[k] = v;
	return {
		id: `tr-${randomUUID()}`,
		at: at.toISOString(),
		requestId: req?.requestId ?? null,
		workspaceId: str(data.workspaceId) ?? scope?.workspaceId ?? req?.workspaceId ?? null,
		runId: str(data.runId) ?? scope?.runId ?? req?.runId ?? null,
		actorKind: actor?.kind ?? null,
		actorId: actorId ?? null,
		via: str(data.via) ?? req?.via ?? null,
		step,
		source: str(data.source, 60) ?? str(data.api, 60) ?? (data.tool ? 'tool' : 'other'),
		model: str(data.model, 120) ?? null,
		tool: str(data.tool, 80) ?? null,
		tokensIn: int(data.tokensIn),
		tokensOut: int(data.tokensOut),
		latencyMs: int(data.latencyMs),
		cache: str(data.cache, 20) ?? null,
		ok: typeof data.ok === 'boolean' ? data.ok : !error,
		error,
		costUnits: typeof data.costUnits === 'number' ? data.costUnits : null,
		data: Object.keys(rest).length ? capJson(rest, MAX_DATA_BYTES) : null
	};
}

interface WriterState {
	queue: TraceRow[];
	timer: ReturnType<typeof setTimeout> | null;
	flushing: Promise<void> | null;
	store: Promise<TraceStore | null> | null;
	lastPrune: number;
	dropped: number;
	failing: boolean;
}

const g = globalThis as typeof globalThis & { __mandateTraces?: WriterState };
const state = (): WriterState =>
	(g.__mandateTraces ??= {
		queue: [],
		timer: null,
		flushing: null,
		store: null,
		lastPrune: 0,
		dropped: 0,
		failing: false
	});

/**
 * Where rows go. Served app: the process's database (Aiven, or PGlite in fixture mode), found on the first flush.
 * Unit tests write nowhere unless they install a store with `setTraceStore`.
 */
function resolveStore(): Promise<TraceStore | null> {
	const s = state();
	s.store ??= process.env.VITEST
		? Promise.resolve(null)
		: import('../store/server-ports')
				.then((m) => m.createServerPorts())
				.then((b) => createTraceStore(b.db))
				.catch((e) => {
					log.warn('trace.store_unavailable', { error: errMsg(e) });
					s.store = null; // try again on the next flush
					return null;
				});
	return s.store;
}

/** Test hook (and the place a script could point traces elsewhere): null turns persistence off. */
export function setTraceStore(store: TraceStore | null): void {
	const s = state();
	s.store = Promise.resolve(store);
	s.queue = [];
	s.dropped = 0;
	s.lastPrune = 0;
}

/** Queues one trace for the next batch. Never blocks, never throws. */
export function recordTrace(step: string, data: Record<string, unknown>): void {
	try {
		enqueue(toTraceRow(step, data));
	} catch {
		// Tracing never fails the call it describes.
	}
}

export function enqueue(row: TraceRow): void {
	const s = state();
	s.queue.push(row);
	if (s.queue.length > MAX_QUEUE) {
		const over = s.queue.length - MAX_QUEUE;
		s.queue.splice(0, over);
		s.dropped += over;
	}
	if (s.queue.length >= BATCH) void flushTraces();
	else if (!s.timer) {
		s.timer = setTimeout(() => {
			s.timer = null;
			void flushTraces();
		}, FLUSH_MS);
		s.timer.unref?.();
	}
}

/** Writes everything queued (one batch at a time) and prunes when due. Resolves when done; never rejects. */
export function flushTraces(now: () => Date = () => new Date()): Promise<void> {
	const s = state();
	if (s.flushing) return s.flushing.then(() => (s.queue.length ? flushTraces(now) : undefined));
	s.flushing = (async () => {
		const store = await resolveStore();
		if (!store) {
			s.queue = [];
			return;
		}
		while (s.queue.length) {
			const batch = s.queue.splice(0, BATCH);
			try {
				await store.insert(batch);
				if (s.failing) log.info('trace.store_recovered', { dropped: s.dropped });
				s.failing = false;
			} catch (e) {
				// Put the batch back for the next flush; the queue cap bounds memory while the database is away.
				s.queue.unshift(...batch);
				if (s.queue.length > MAX_QUEUE) {
					const over = s.queue.length - MAX_QUEUE;
					s.queue.splice(0, over);
					s.dropped += over;
				}
				if (!s.failing)
					log.warn('trace.write_failed', { error: errMsg(e), queued: s.queue.length });
				s.failing = true;
				if (!s.timer) {
					s.timer = setTimeout(() => {
						s.timer = null;
						void flushTraces();
					}, FLUSH_MS * 5);
					s.timer.unref?.();
				}
				return;
			}
		}
		const t = now().getTime();
		if (t - s.lastPrune >= PRUNE_EVERY_MS) {
			s.lastPrune = t;
			try {
				const gone = await store.prune(new Date(t - RETAIN_MS));
				if (gone) log.debug('trace.pruned', { rows: gone });
			} catch (e) {
				log.warn('trace.prune_failed', { error: errMsg(e) });
			}
		}
	})().finally(() => {
		s.flushing = null;
	});
	return s.flushing;
}

/** How the writer is doing, for /healthz-style reads and tests. */
export function traceWriterStatus() {
	const s = state();
	return { queued: s.queue.length, dropped: s.dropped, failing: s.failing };
}

/** The store the read routes use: the same one the writer writes. */
export async function traceStore(): Promise<TraceStore | null> {
	return resolveStore();
}
