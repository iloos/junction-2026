import { describe, expect, it } from 'vitest';
import { orderedSender } from './ordered';

type E = { seq: number; from?: string };

function setup(log: number[], after = 0) {
	const sent: E[] = [];
	const reads: number[] = [];
	const s = orderedSender<E>({
		after,
		deliver: (e) => sent.push(e),
		readAfter: async (from) => {
			reads.push(from);
			await new Promise((r) => setTimeout(r, 5));
			return log.filter((n) => n > from).map((seq) => ({ seq, from: 'log' }));
		}
	});
	return { s, sent, reads };
}

describe('ordered live delivery', () => {
	it('delivers in order without reading the log when nothing is missing', async () => {
		const { s, sent, reads } = setup([1, 2, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 2 });
		s.push({ seq: 3 });
		await s.idle();
		expect(sent.map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(reads).toEqual([]);
	});

	it('two publishers: seq 3 arrives before 2; the gap is read from the log, then both go out in order', async () => {
		const { s, sent, reads } = setup([1, 2, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 3 });
		s.push({ seq: 2 }); // its notification arrives late, while the log read is in flight
		await s.idle();
		expect(sent.map((e) => e.seq)).toEqual([1, 2, 3]);
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

	it("skips seqs this run's log doesn't have (another run's ops) instead of waiting", async () => {
		const { s, sent } = setup([1, 3]);
		s.push({ seq: 1 });
		s.push({ seq: 3 });
		await s.idle();
		expect(sent.map((e) => e.seq)).toEqual([1, 3]);
		s.push({ seq: 4 });
		expect(sent.map((e) => e.seq)).toEqual([1, 3, 4]);
	});

	it('never sends a seq twice or below what the client has', async () => {
		const { s, sent } = setup([5, 6, 7, 8], 5);
		s.push({ seq: 5 });
		s.push({ seq: 8 });
		s.push({ seq: 7 });
		s.push({ seq: 6 });
		s.push({ seq: 8 });
		await s.idle();
		expect(sent.map((e) => e.seq)).toEqual([6, 7, 8]);
	});

	it('a failed log read still delivers what is held, in order', async () => {
		const sent: number[] = [];
		const s = orderedSender<E>({
			after: 0,
			deliver: (e) => sent.push(e.seq),
			readAfter: async () => {
				throw new Error('db down');
			}
		});
		s.push({ seq: 1 });
		s.push({ seq: 4 });
		s.push({ seq: 3 });
		await s.idle();
		expect(sent).toEqual([1, 3, 4]);
	});
});
