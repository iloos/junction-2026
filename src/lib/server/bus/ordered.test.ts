import { describe, expect, it } from 'vitest';
import { orderedSender, RETRY_MS, type LogRead } from './ordered';

type E = { seq: number; from?: string };

/** A sender over a fake log of `log` seqs (this run's), read `page` at a time; failures scripted by `fail`. */
function setup(log: number[], o: { after?: number; page?: number; fail?: number } = {}) {
	const sent: E[] = [];
	const reads: number[] = [];
	const lost: unknown[] = [];
	let failures = o.fail ?? 0;
	const s = orderedSender<E>({
		after: o.after ?? 0,
		deliver: (e) => sent.push(e),
		readAfter: async (from): Promise<LogRead<E>> => {
			reads.push(from);
			await new Promise((r) => setTimeout(r, 2));
			if (failures > 0) {
				failures -= 1;
				throw new Error('db down');
			}
			const after = log.filter((n) => n > from);
			const page = o.page ?? 1000;
			return {
				events: after.slice(0, page).map((seq) => ({ seq, from: 'log' })),
				complete: after.length <= page
			};
		},
		onLost: (err) => lost.push(err),
		wait: async () => {}
	});
	return { s, sent, reads, lost, seqs: () => sent.map((e) => e.seq) };
}

describe('ordered live delivery', () => {
	it('delivers in order without reading the log when nothing is missing', async () => {
		const { s, seqs, reads } = setup([1, 2, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 2 });
		s.push({ seq: 3 });
		await s.idle();
		expect(seqs()).toEqual([1, 2, 3]);
		expect(reads).toEqual([]);
	});

	it('two publishers: seq 3 before 2; the gap is read from the log, then both go out in order', async () => {
		const { s, seqs, reads } = setup([1, 2, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 3 });
		s.push({ seq: 2 });
		await s.idle();
		expect(seqs()).toEqual([1, 2, 3]);
		expect(reads).toEqual([1]);
	});

	it('a notification that never arrives is recovered from the log', async () => {
		const { s, sent } = setup([1, 2, 3, 4]);
		s.push({ seq: 1 });
		s.push({ seq: 4 });
		await s.idle();
		expect(sent.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		expect(sent.find((e) => e.seq === 2)?.from).toBe('log');
	});

	it("skips seqs a complete read shows aren't this run's (another run's ops)", async () => {
		const { s, seqs } = setup([1, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 3 });
		await s.idle();
		expect(seqs()).toEqual([1, 3]);
		s.push({ seq: 4 });
		expect(seqs()).toEqual([1, 3, 4]);
	});

	it('never sends a seq twice or below what the client has', async () => {
		const { s, seqs } = setup([5, 6, 7, 8], { after: 5 });
		s.push({ seq: 5 });
		s.push({ seq: 8 });
		s.push({ seq: 7 });
		s.push({ seq: 6 });
		s.push({ seq: 8 });
		await s.idle();
		expect(seqs()).toEqual([6, 7, 8]);
	});

	it('R11-06: a transient read failure is retried, and nothing is skipped', async () => {
		const { s, seqs, lost } = setup([1, 2, 3], { fail: 2 });
		s.push({ seq: 2 });
		s.push({ seq: 3 });
		await s.idle();
		expect(seqs()).toEqual([1, 2, 3]);
		expect(lost).toEqual([]);
	});

	it('R11-06: a read that keeps failing gives the stream up instead of moving past the gap', async () => {
		const { s, seqs, lost } = setup([1, 2, 3], { fail: RETRY_MS.length + 1 });
		s.push({ seq: 2 });
		s.push({ seq: 3 });
		await s.idle();
		// Seq 1 was never proven absent: nothing after it is sent, and the client reconnects from 0.
		expect(seqs()).toEqual([]);
		expect(s.last()).toBe(0);
		expect(lost).toHaveLength(1);
		s.push({ seq: 1 });
		expect(seqs()).toEqual([]);
	});

	it('R11-06: a read cut at its page cap reads on before deciding a seq is absent', async () => {
		const log = Array.from({ length: 25 }, (_, i) => i + 1);
		const { s, seqs, reads } = setup(log, { page: 10 });
		s.push({ seq: 25 });
		await s.idle();
		expect(seqs()).toEqual(log);
		expect(reads).toEqual([0, 10, 20]);
	});
});
