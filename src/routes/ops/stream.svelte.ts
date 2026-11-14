import type { OpEnvelope, ServerEvent, SimEvent } from '$lib/core/contracts';
import { applyOps, emptyState, type WorkspaceState } from '$lib/core/state';
import { lineKey } from './cases';
import { lineIsHeld } from './labels';

export type LogEntry =
	| { kind: 'op'; seq: number; envelope: OpEnvelope; rejected?: string }
	| { kind: 'sim'; seq: number; runId: string; event: SimEvent };

/** One agent run as seen through its trace events (CLAUDE.md rule 7). */
export interface TraceRun {
	id: string;
	goal: string;
	startedAt: string;
	steps: TraceRow[];
	done?: {
		stopped: string;
		summary: string;
		at: string;
		/** The agent's GoalOutcome, when it reported one. */
		outcome?: { status: string; nextAction: string; reason?: string };
	};
}
export interface TraceRow {
	at: string;
	step: Extract<ServerEvent, { kind: 'trace' }>['step'];
	data: Record<string, unknown>;
}

/**
 * One call's identity across the live stream and the stored traces: the stored row's id isn't on the live event,
 * so both are keyed by what the call was (time, step, source, model or tool, latency).
 */
export function traceKey(e: Extract<ServerEvent, { kind: 'trace' }>): string {
	const d = e.data;
	const what = d.model ?? d.tool ?? d.source ?? '';
	return `${e.at}|${e.step}|${String(d.source ?? '')}|${String(what)}|${String(d.latencyMs ?? '')}`;
}

export type Status = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

const LOG_CAP = 200;
const TRACE_RUN_CAP = 20;
const POLL_MS = 2500;
/** Consecutive EventSource errors before falling back to polling. */
const MAX_SSE_ERRORS = 3;
/** Minimum gap between two rebuilds of the board from the server (see `resync`). */
const RESYNC_MS = 10_000;

/**
 * Client side of /api/events: dedupes by seq, batches per animation frame, reduces ops with the
 * same pure `applyOps` the server uses, and falls back to polling when SSE keeps failing.
 */
export class OpsStream {
	state: WorkspaceState = $state.raw(emptyState('', ''));
	log: LogEntry[] = $state.raw([]);
	status: Status = $state('connecting');
	last = $state(0);
	/** seq of the newest entry, to highlight what just arrived. */
	fresh = $state(0);
	catchupError: string | null = $state(null);
	simClock: string | null = $state(null);
	/** When each plan line was first seen held (op time), for case age. Key: lineKey(planId, lineId). */
	heldSince: Record<string, string> = $state.raw({});
	/** Agent runs and requests, newest first: the stored calls of the last day, then live ones as they happen. */
	traces: TraceRun[] = $state.raw([]);
	/** Ops the reducer refused (stale writes from another run or process), shown as one muted line. */
	refused = $state(0);
	lastRefused: string | null = $state(null);
	/** Wall ms the current run started, from the server (`ready` and `run` events): the clock's anchor. */
	runStartedAt: number | null = $state(null);

	private es: EventSource | null = null;
	private queue: ServerEvent[] = [];
	private frame = 0;
	private errors = 0;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	/** Last time the board was rebuilt after an op the reducer refused (at most one rebuild per RESYNC_MS). */
	private resyncedAt = 0;
	private stopped = false;

	constructor(
		private workspaceId: string,
		/** Extra query for the stream (the dev load test passes copies=N). */
		private extraQuery = ''
	) {
		this.state = emptyState(workspaceId, '');
	}

	start(): void {
		this.stopped = false;
		this.openSse();
		void this.loadStored();
	}

	/** Whether stored calls were read: null while loading, false when the database has none to give. */
	storedTraces: boolean | null = $state(null);

	/** Reads the calls stored before this page opened (GET /api/ops/traces?as=events) into the trace runs. */
	private async loadStored(): Promise<void> {
		try {
			const r = await fetch(
				`/api/ops/traces?ws=${encodeURIComponent(this.workspaceId)}&since=1d&limit=500&as=events`
			);
			if (!r.ok) throw new Error(String(r.status));
			const { events } = (await r.json()) as { events?: Extract<ServerEvent, { kind: 'trace' }>[] };
			this.loadHistory(events ?? []);
			this.storedTraces = (events ?? []).length > 0;
		} catch {
			this.storedTraces = false;
		}
	}

	stop(): void {
		this.stopped = true;
		this.es?.close();
		this.es = null;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		cancelAnimationFrame(this.frame);
	}

	private url(extra = '') {
		return `/api/events?ws=${encodeURIComponent(this.workspaceId)}&after=${this.last}${this.extraQuery}${extra}`;
	}

	private openSse(): void {
		this.status = this.last ? 'reconnecting' : 'connecting';
		const es = new EventSource(this.url());
		this.es = es;
		const onEvent = (m: MessageEvent) => this.enqueue(JSON.parse(m.data) as ServerEvent);
		es.addEventListener('op', onEvent);
		es.addEventListener('sim', onEvent);
		es.addEventListener('trace', (m) => this.onTrace(JSON.parse((m as MessageEvent).data)));
		es.addEventListener('ready', (m) => {
			this.errors = 0;
			this.status = 'live';
			const { startedAt } = JSON.parse((m as MessageEvent).data) as { startedAt?: number };
			if (typeof startedAt === 'number') this.runStartedAt = startedAt;
		});
		es.addEventListener('run', (m) => {
			const { runId, startedAt } = JSON.parse((m as MessageEvent).data) as {
				runId: string;
				startedAt?: number;
			};
			this.resetTo(runId, startedAt);
		});
		es.addEventListener('catchup-error', (m) => {
			this.catchupError = (JSON.parse((m as MessageEvent).data) as { message: string }).message;
		});
		es.onerror = () => {
			if (this.stopped) return;
			this.errors += 1;
			this.status = 'reconnecting';
			if (this.errors >= MAX_SSE_ERRORS) {
				es.close();
				this.es = null;
				this.poll();
			}
		};
	}

	/** Poll mode: fetch what we missed, then try SSE again on the next success. */
	private async poll(): Promise<void> {
		if (this.stopped) return;
		this.status = 'polling';
		try {
			const r = await fetch(this.url('&mode=poll'));
			if (!r.ok) throw new Error(String(r.status));
			const { events } = (await r.json()) as { events: ServerEvent[] };
			for (const e of events) this.enqueue(e);
			this.errors = 0;
			this.openSse();
		} catch {
			this.status = 'offline';
			this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
		}
	}

	/** A fresh run started: clear the board and the log, keep the seq cursor, re-anchor the clock. */
	resetTo(runId: string, startedAt?: number): void {
		if (Number.isFinite(startedAt)) this.runStartedAt = startedAt!;
		this.state = emptyState(this.workspaceId, runId);
		this.log = [];
		this.heldSince = {};
		this.simClock = null;
	}

	/** Calls already shown, live or stored, so a call read twice shows once. Bookkeeping only: nothing renders it. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private seenTraces = new Set<string>();

	/**
	 * Stored trace events (GET /api/ops/traces?as=events, oldest first) for this run: what happened before the page
	 * opened. Merged with the live ones: a stored row and its live twin show once.
	 */
	loadHistory(events: Extract<ServerEvent, { kind: 'trace' }>[]): void {
		for (const e of events)
			if (!e.runId || !this.state.runId || e.runId === this.state.runId) this.onTrace(e);
		// Live calls may have arrived first: put runs newest first and each run's steps in time order.
		this.traces = this.traces
			.map((r) => ({ ...r, steps: [...r.steps].sort((a, b) => a.at.localeCompare(b.at)) }))
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	}

	private onTrace(e: Extract<ServerEvent, { kind: 'trace' }>): void {
		const key = traceKey(e);
		if (this.seenTraces.has(key)) return;
		this.seenTraces.add(key);
		const d = e.data;
		// An agent run groups its own steps; any other call groups by the request it served.
		const id =
			typeof d.agentRun === 'string'
				? d.agentRun
				: typeof d.requestId === 'string'
					? `req:${d.requestId}`
					: 'untagged';
		const runs = [...this.traces];
		let i = runs.findIndex((r) => r.id === id);
		if (i < 0) {
			runs.unshift({
				id,
				goal:
					typeof d.goal === 'string'
						? d.goal
						: typeof d.requestId === 'string'
							? `Request ${d.requestId.slice(-8)}`
							: '',
				startedAt: e.at,
				steps: []
			});
			i = 0;
		}
		const run = { ...runs[i] };
		if (e.at < run.startedAt) run.startedAt = e.at;
		if (e.step === 'done')
			run.done = {
				stopped: String(e.data.stopped),
				summary: String(e.data.summary ?? ''),
				at: e.at,
				outcome: outcomeOf(e.data.outcome)
			};
		else if (!(e.step === 'step' && e.data.n === 0))
			run.steps = [...run.steps, { at: e.at, step: e.step, data: e.data }];
		runs[i] = run;
		this.traces = runs.slice(0, TRACE_RUN_CAP);
	}

	private enqueue(e: ServerEvent): void {
		this.queue.push(e);
		if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
	}

	private flush(): void {
		this.frame = 0;
		const batch = this.queue
			.splice(0)
			.sort((a, b) => ('seq' in a && 'seq' in b ? a.seq - b.seq : 0));
		let state = this.state;
		let since = this.heldSince;
		let batchAt: string | null = null;
		const added: LogEntry[] = [];
		let refused = false;
		for (const e of batch) {
			if (!('seq' in e) || e.seq <= this.last) continue;
			const runId = e.kind === 'op' ? e.envelope.runId : e.runId;
			if (runId !== state.runId) {
				// A new run (reset or scenario restart): start from empty, keep the log.
				state = emptyState(this.workspaceId, runId);
				since = {};
			}
			if (e.kind === 'sim') {
				this.last = e.seq;
				added.push({ kind: 'sim', seq: e.seq, runId, event: e.event });
				this.simClock = e.event.simAt;
				continue;
			}
			const r = applyOps(state, [e.envelope]);
			if (!r.ok && this.resync()) {
				// The board has drifted from the server (an op it depends on never arrived): stop here and
				// rebuild from the run's whole op log instead of skipping this one.
				refused = true;
				break;
			}
			this.last = e.seq;
			if (r.ok) {
				state = r.value;
				batchAt = e.envelope.at;
				added.push({ kind: 'op', seq: e.seq, envelope: e.envelope });
			} else {
				// A write the board can't apply even after a rebuild (another run, a lagging process): counted,
				// not listed, so stale writes never lead the feed.
				this.refused += 1;
				this.lastRefused = `${r.error.code}: ${r.error.message}`;
			}
		}
		if (refused || !added.length) return;
		// One pass per batch (a frame's worth of events): first-held time = the batch's last op time.
		if (batchAt) since = trackHeld(since, state, batchAt);
		this.state = state;
		this.heldSince = since;
		this.log = [...added.reverse(), ...this.log].slice(0, LOG_CAP);
		this.fresh = this.last;
	}

	/**
	 * Rebuild the board from the server: empty state, cursor 0, a fresh catch-up of the current run. Returns false
	 * (and the refused op is only logged) if a rebuild just happened, so a genuinely bad op can't loop.
	 */
	private resync(): boolean {
		const now = Date.now();
		if (now - this.resyncedAt < RESYNC_MS) return false;
		this.resyncedAt = now;
		this.queue = [];
		this.last = 0;
		this.resetTo(this.state.runId);
		this.es?.close();
		this.es = null;
		if (!this.stopped) this.openSse();
		return true;
	}
}

/** First-held times: add lines that are held now, drop lines that no longer are. */
function trackHeld(
	prev: Record<string, string>,
	s: WorkspaceState,
	at: string
): Record<string, string> {
	const next: Record<string, string> = {};
	for (const p of Object.values(s.plans))
		for (const l of p.lines)
			if (lineIsHeld(l)) {
				const k = lineKey(p.id, l.id);
				next[k] = prev[k] ?? at;
			}
	return next;
}

function outcomeOf(
	v: unknown
): { status: string; nextAction: string; reason?: string } | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const o = v as Record<string, unknown>;
	if (typeof o.status !== 'string') return undefined;
	return {
		status: o.status,
		nextAction: typeof o.nextAction === 'string' ? o.nextAction : '',
		...(typeof o.reason === 'string' ? { reason: o.reason } : {})
	};
}
