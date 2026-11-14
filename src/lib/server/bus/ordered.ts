/**
 * In-order delivery of a live op stream. Notifications can arrive out of seq order (two processes publishing at
 * once, or a referenced op still loading), and the op stream drops any seq at or below the highest it has sent.
 * So an op that skips ahead (N+2 while the client has N) is held and the missing range is read from the op log
 * (the durable record), then everything goes out in seq order.
 *
 * A gap is only skipped when the log proves it: a complete read of this run's ops after N that doesn't contain
 * N+1 (another run's ops share the workspace's sequence). A read that stopped at its page cap reads on; a read
 * that fails is retried, and if it keeps failing the stream gives up (`onLost`) without moving past the gap, so
 * the client reconnects from the last seq it really has and catches up from the log.
 */
export interface Seqd {
	seq: number;
}

/** One read of the log: the events after `from`, and whether it reached the end (not cut at a page cap). */
export interface LogRead<E> {
	events: E[];
	complete: boolean;
}

export interface OrderedSender<E extends Seqd> {
	/** A live event; delivered now if it is next, else held until the gap is read from the log. */
	push(e: E): void;
	/** Everything pushed so far has been delivered or given up on (for tests). */
	idle(): Promise<void>;
	/** The highest seq delivered. */
	last(): number;
}

/** Waits between read attempts after a failure; then the stream gives up and the client reconnects. */
export const RETRY_MS = [200, 800, 2000];

export function orderedSender<E extends Seqd>(o: {
	/** The highest seq the client already has. */
	after: number;
	deliver: (e: E) => void;
	/** The log's events after `from` (this run's), in seq order, at most one page. */
	readAfter: (from: number) => Promise<LogRead<E>>;
	/** The gap could not be read: close the stream so the client reconnects from `last()`. */
	onLost: (err: unknown) => void;
	/** Test hook: how long to wait (default setTimeout). */
	wait?: (ms: number) => Promise<void>;
}): OrderedSender<E> {
	let last = o.after;
	const held = new Map<number, E>();
	let repair: Promise<void> | null = null;
	let lost = false;
	const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

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

	/** One read, retried on failure; throws when every attempt failed. */
	async function readOnce(from: number): Promise<LogRead<E>> {
		let error: unknown;
		for (let i = 0; i <= RETRY_MS.length; i++) {
			try {
				return await o.readAfter(from);
			} catch (err) {
				error = err;
				if (i < RETRY_MS.length) await wait(RETRY_MS[i]);
			}
		}
		throw error;
	}

	async function fill() {
		try {
			// Read on until the log is exhausted (a complete read), or every held event is next in line.
			for (;;) {
				const r = await readOnce(last);
				for (const e of r.events) {
					held.delete(e.seq);
					emit(e);
				}
				drain();
				if (!held.size) return;
				if (r.complete) break;
				if (!r.events.length) break; // a capped read that made no progress: nothing more to read now
			}
			// A complete read without the missing seqs proves they aren't this run's: deliver the rest in order.
			for (const e of [...held.values()].sort((a, b) => a.seq - b.seq)) emit(e);
			held.clear();
		} catch (err) {
			// Never move past a gap the log didn't rule out: give up on this stream instead.
			held.clear();
			lost = true;
			o.onLost(err);
		}
	}
	function startRepair() {
		repair ??= fill().finally(() => {
			repair = null;
			if (lost) return;
			drain();
			if (held.size) startRepair();
		});
	}

	return {
		push(e) {
			if (lost || e.seq <= last) return;
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
