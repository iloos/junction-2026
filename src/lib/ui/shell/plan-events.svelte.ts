/**
 * The page and the agent dock read one event stream (/api/events, this browser's sandbox) so what one does, the
 * other shows. One EventSource per browser tab, opened when the first screen subscribes and closed with the last;
 * ops are deduped by seq and handed out in bursts (one refresh per burst, never a loop).
 */
import type { OpEnvelope } from '$lib/core/contracts';

type Listener = (ops: OpEnvelope[]) => void;

/** The plan an op touches, if any. */
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
		default:
			return null;
	}
}

const BURST_MS = 400;

export class PlanEvents {
	// Callbacks, not state anything renders: a plain Set on purpose.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#listeners = new Set<Listener>();
	#es: EventSource | null = null;
	#last = 0;
	#batch: OpEnvelope[] = [];
	#timer: ReturnType<typeof setTimeout> | null = null;
	#starting = false;

	/** Calls `fn` with each burst of new ops; returns the unsubscribe. */
	subscribe(fn: Listener): () => void {
		this.#listeners.add(fn);
		void this.#open();
		return () => {
			this.#listeners.delete(fn);
			if (!this.#listeners.size) this.#close();
		};
	}

	async #open() {
		if (this.#es || this.#starting || typeof EventSource === 'undefined') return;
		this.#starting = true;
		try {
			// Start from now: what happened before this screen opened is already in its first read.
			const r = await fetch('/api/events?mode=poll&after=0', { cache: 'no-store' });
			const j = (await r.json()) as { last?: number };
			this.#last = j.last ?? 0;
		} catch {
			this.#last = 0;
		}
		this.#starting = false;
		if (!this.#listeners.size || this.#es) return;
		const es = new EventSource(`/api/events?after=${this.#last}`);
		es.addEventListener('op', (m) => {
			const e = JSON.parse((m as MessageEvent).data) as { seq: number; envelope: OpEnvelope };
			if (e.seq <= this.#last) return;
			this.#last = e.seq;
			this.#batch.push(e.envelope);
			this.#timer ??= setTimeout(() => this.#flush(), BURST_MS);
		});
		this.#es = es;
	}

	#flush() {
		this.#timer = null;
		const ops = this.#batch;
		this.#batch = [];
		if (ops.length) for (const fn of this.#listeners) fn(ops);
	}

	#close() {
		this.#es?.close();
		this.#es = null;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#batch = [];
	}
}
