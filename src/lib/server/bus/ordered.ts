/**
 * In-order delivery of a live op stream. Notifications can arrive out of seq order (two processes publishing at
 * once, or a referenced op still loading), and the op stream drops any seq at or below the highest it has sent.
 * So an op that skips ahead (N+2 while the client has N) is held, the missing range is read from the op log
 * (the durable record), and everything goes out in seq order. Seqs the log doesn't have for this run (another
 * run's ops share the workspace's sequence) are skipped after that read, never waited on.
 */
export interface Seqd {
	seq: number;
}

export interface OrderedSender<E extends Seqd> {
	/** A live event; delivered now if it is next, else held until the gap is read from the log. */
	push(e: E): void;
	/** Everything pushed so far has been delivered (for tests). */
	idle(): Promise<void>;
	/** The highest seq delivered. */
	last(): number;
}

export function orderedSender<E extends Seqd>(o: {
	/** The highest seq the client already has. */
	after: number;
	deliver: (e: E) => void;
	/** The log's events after `from` (this run's), in seq order. */
	readAfter: (from: number) => Promise<E[]>;
	onError?: (e: unknown) => void;
}): OrderedSender<E> {
	let last = o.after;
	const held = new Map<number, E>();
	let repair: Promise<void> | null = null;

	const emit = (e: E) => {
		if (e.seq <= last) return;
		last = e.seq;
		o.deliver(e);
	};
	/** Deliver held events that are now next in line. */
	const drain = () => {
		for (;;) {
			const next = held.get(last + 1);
			if (!next) return;
			held.delete(next.seq);
			emit(next);
		}
	};

	async function fill() {
		try {
			for (const e of await o.readAfter(last)) {
				held.delete(e.seq);
				emit(e);
			}
		} catch (err) {
			o.onError?.(err);
		}
		// What the log doesn't have for this run is not coming: deliver the rest in order.
		for (const e of [...held.values()].sort((a, b) => a.seq - b.seq)) emit(e);
		held.clear();
	}
	function startRepair() {
		repair ??= fill().finally(() => {
			repair = null;
			drain();
			if (held.size) startRepair();
		});
	}

	return {
		push(e) {
			if (e.seq <= last) return;
			if (e.seq === last + 1 && !repair) {
				emit(e);
				drain();
				return;
			}
			held.set(e.seq, e);
			startRepair();
		},
		async idle() {
			while (repair) await repair;
		},
		last: () => last
	};
}
