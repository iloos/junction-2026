/**
 * The page and the agent dock read one event stream (/api/events) so what one does, the other shows. One
 * EventSource per browser tab, on the room the page shows (its workspace, else the browser's own sandbox), opened
 * when the first screen subscribes and closed with the last. Ops are deduped by seq and handed out in bursts (one
 * refresh per burst, never a loop). Subscribers also get one `resync` when the stream opens, when it follows
 * another room, and when the run changes (a reset elsewhere), so nothing that landed between their first read and
 * the stream opening is lost.
 */
import type { OpEnvelope } from '$lib/core/contracts';

export interface Burst {
	ops: OpEnvelope[];
	/** Re-read everything: the stream (re)opened or the run changed; ops may be empty. */
	resync: boolean;
	/** The run changed (the sandbox was started over elsewhere): plans on screen belong to the old run. */
	newRun: boolean;
}
type Listener = (b: Burst) => void;

/** A live room or shortage notice (kitchen.created, shortage.replanned): not in the op log, never replayed. */
export interface Notice {
	at: string;
	event: { kind: string; label?: string; detail?: unknown };
}
type NoticeListener = (n: Notice) => void;

/** The plan an op touches, if any (a recall names one when it hit a planned line). */
export function planOf(op: OpEnvelope['op']): string | null {
	switch (op.type) {
		case 'CreatePlan':
			return op.plan.id;
		case 'EditLine':
		case 'RecordOffer':
		case 'ProposeSubstitute':
			return op.planId;
		case 'RecordApproval':
			return op.approval.planId;
		case 'CommitOrder':
			return op.outcome.result === 'committed' ? op.outcome.order.planId : op.outcome.planId;
		case 'RecordAnomaly':
			return op.anomaly.planId ?? null;
		default:
			return null;
	}
}

/** The product an op is about when it names no plan (a recall or a stock change): screens match it to their lines. */
export function productOf(op: OpEnvelope['op']): string | null {
	return op.type === 'RecordAnomaly' ? (op.anomaly.productId ?? null) : null;
}

const BURST_MS = 400;

export class PlanEvents {
	// Callbacks, not state anything renders: a plain Set on purpose.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#listeners = new Set<Listener>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#notices = new Set<NoticeListener>();
	#es: EventSource | null = null;
	#last = 0;
	#batch: OpEnvelope[] = [];
	#resync = false;
	#newRun = false;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#opening = 0;
	/** The room the stream follows; null = the browser's own sandbox (the server's default). */
	#workspace: string | null = null;

	/** Follow the room the page shows; reopens the stream (and resyncs) when it changes. */
	follow(workspace: string | null | undefined) {
		const ws = workspace ?? null;
		if (ws === this.#workspace) return;
		this.#workspace = ws;
		if (this.#listeners.size) {
			this.#close();
			void this.#open();
		}
	}

	/** Calls `fn` with each burst of new ops, and once with `resync` when the stream opens; returns the unsubscribe. */
	subscribe(fn: Listener): () => void {
		this.#listeners.add(fn);
		void this.#open();
		return () => {
			this.#listeners.delete(fn);
			if (!this.#listeners.size) this.#close();
		};
	}

	/** Calls `fn` with each live notice; keeps the stream open while subscribed; returns the unsubscribe. */
	notices(fn: NoticeListener): () => void {
		this.#notices.add(fn);
		const keep: Listener = () => {};
		const off = this.subscribe(keep);
		return () => {
			this.#notices.delete(fn);
			off();
		};
	}

	#url(after: number, poll = false) {
		const ws = this.#workspace ? `&ws=${encodeURIComponent(this.#workspace)}` : '';
		return `/api/events?after=${after}${poll ? '&mode=poll' : ''}${ws}`;
	}

	async #open() {
		if (this.#es || typeof EventSource === 'undefined') return;
		const attempt = ++this.#opening;
		let last: number;
		try {
			const r = await fetch(this.#url(0, true), { cache: 'no-store' });
			last = ((await r.json()) as { last?: number }).last ?? 0;
		} catch {
			last = 0;
		}
		// A newer open (another room) or a close happened meanwhile: this one is stale.
		if (attempt !== this.#opening || !this.#listeners.size || this.#es) return;
		this.#last = last;
		const es = new EventSource(this.#url(last));
		es.addEventListener('op', (m) => {
			const e = JSON.parse((m as MessageEvent).data) as { seq: number; envelope: OpEnvelope };
			if (e.seq <= this.#last) return;
			this.#last = e.seq;
			this.#batch.push(e.envelope);
			this.#schedule();
		});
		es.addEventListener('notice', (m) => {
			try {
				const n = JSON.parse((m as MessageEvent).data) as Notice;
				for (const fn of this.#notices) fn(n);
			} catch {
				/* a malformed notice is dropped; the plans on load still say what happened */
			}
		});
		// A reset elsewhere started a new run: everything on screen is from the old one.
		es.addEventListener('run', () => {
			this.#resync = true;
			this.#newRun = true;
			this.#schedule();
		});
		this.#es = es;
		// Whatever landed between the screens' first read and this stream opening: re-read once.
		this.#resync = true;
		this.#schedule();
	}

	#schedule() {
		this.#timer ??= setTimeout(() => this.#flush(), BURST_MS);
	}

	#flush() {
		this.#timer = null;
		const burst: Burst = { ops: this.#batch, resync: this.#resync, newRun: this.#newRun };
		this.#batch = [];
		this.#resync = false;
		this.#newRun = false;
		if (burst.ops.length || burst.resync) for (const fn of this.#listeners) fn(burst);
	}

	#close() {
		this.#opening++;
		this.#es?.close();
		this.#es = null;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#batch = [];
		this.#resync = false;
		this.#newRun = false;
	}
}
