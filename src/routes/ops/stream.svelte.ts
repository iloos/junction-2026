import type { OpEnvelope, ServerEvent, SimEvent } from '$lib/core/contracts';
import { applyOps, emptyState, type WorkspaceState } from '$lib/core/state';
import { lineKey } from './cases';

export type LogEntry =
	| { kind: 'op'; seq: number; envelope: OpEnvelope; rejected?: string }
	| { kind: 'sim'; seq: number; runId: string; event: SimEvent };

/** One agent run as seen through its trace events (CLAUDE.md rule 7). */
export interface TraceRun {
	id: string;
	goal: string;
	startedAt: string;
	steps: TraceRow[];
	done?: { stopped: string; summary: string; at: string };
}
export interface TraceRow {
	at: string;
	step: Extract<ServerEvent, { kind: 'trace' }>['step'];
	data: Record<string, unknown>;
}

export type Status = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

const LOG_CAP = 200;
const TRACE_RUN_CAP = 20;
const POLL_MS = 2500;
/** Consecutive EventSource errors before falling back to polling. */
const MAX_SSE_ERRORS = 3;

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
	/** Agent runs, newest first; traces are live only (they have no seq and no catch-up). */
	traces: TraceRun[] = $state.raw([]);

	private es: EventSource | null = null;
	private queue: ServerEvent[] = [];
	private frame = 0;
	private errors = 0;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
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
	}

	stop(): void {
		this.stopped = true;
		this.es?.close();
		this.es = null;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		cancelAnimationFrame(this.frame);
	}

	private url(extra = '') {
		return `/api/events?workspace=${encodeURIComponent(this.workspaceId)}&after=${this.last}${this.extraQuery}${extra}`;
	}

	private openSse(): void {
		this.status = this.last ? 'reconnecting' : 'connecting';
		const es = new EventSource(this.url());
		this.es = es;
		const onEvent = (m: MessageEvent) => this.enqueue(JSON.parse(m.data) as ServerEvent);
		es.addEventListener('op', onEvent);
		es.addEventListener('sim', onEvent);
		es.addEventListener('trace', (m) => this.onTrace(JSON.parse((m as MessageEvent).data)));
		es.addEventListener('ready', () => {
			this.errors = 0;
			this.status = 'live';
		});
		es.addEventListener('run', (m) => {
			const { runId } = JSON.parse((m as MessageEvent).data) as { runId: string };
			this.resetTo(runId);
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

	/** A fresh run started: clear the board and the log, keep the seq cursor. */
	resetTo(runId: string): void {
		this.state = emptyState(this.workspaceId, runId);
		this.log = [];
		this.heldSince = {};
		this.simClock = null;
	}

	private onTrace(e: Extract<ServerEvent, { kind: 'trace' }>): void {
		const id = typeof e.data.agentRun === 'string' ? e.data.agentRun : 'untagged';
		const runs = [...this.traces];
		let i = runs.findIndex((r) => r.id === id);
		if (i < 0) {
			runs.unshift({
				id,
				goal: typeof e.data.goal === 'string' ? e.data.goal : '',
				startedAt: e.at,
				steps: []
			});
			i = 0;
		}
		const run = { ...runs[i] };
		if (e.step === 'done')
			run.done = {
				stopped: String(e.data.stopped),
				summary: String(e.data.summary ?? ''),
				at: e.at
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
		for (const e of batch) {
			if (!('seq' in e) || e.seq <= this.last) continue;
			this.last = e.seq;
			const runId = e.kind === 'op' ? e.envelope.runId : e.runId;
			if (runId !== state.runId) {
				// A new run (reset or scenario restart): start from empty, keep the log.
				state = emptyState(this.workspaceId, runId);
				since = {};
			}
			if (e.kind === 'sim') {
				added.push({ kind: 'sim', seq: e.seq, runId, event: e.event });
				this.simClock = e.event.simAt;
				continue;
			}
			const r = applyOps(state, [e.envelope]);
			if (r.ok) {
				state = r.value;
				batchAt = e.envelope.at;
				added.push({ kind: 'op', seq: e.seq, envelope: e.envelope });
			} else
				added.push({
					kind: 'op',
					seq: e.seq,
					envelope: e.envelope,
					rejected: `${r.error.code}: ${r.error.message}`
				});
		}
		if (!added.length) return;
		// One pass per batch (a frame's worth of events): first-held time = the batch's last op time.
		if (batchAt) since = trackHeld(since, state, batchAt);
		this.state = state;
		this.heldSince = since;
		this.log = [...added.reverse(), ...this.log].slice(0, LOG_CAP);
		this.fresh = this.last;
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
			if (l.state === 'held' || l.state === 'unorderable') {
				const k = lineKey(p.id, l.id);
				next[k] = prev[k] ?? at;
			}
	return next;
}
