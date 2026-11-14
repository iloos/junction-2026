/* eslint-disable @typescript-eslint/no-explicit-any -- the fake SQL driver mimics postgres.js loosely */
/**
 * Adversarial regression, round 10 transport (R10-09): two post-commit publishers on the real `PgTransport` with a
 * faked NOTIFY that delays seq 1, composed with the ordered sender /api/events uses (bus/ordered.ts, gaps read from
 * the op log). Every op must reach a live client once, in sequence. `ADV_SHOW=1` runs every case plainly.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
	listener: null as null | ((text: string) => void),
	pause: null as null | Promise<void>,
	sent: [] as number[]
}));
vi.mock('$lib/server/db/client', () => ({
	sql: () =>
		Object.assign(async () => [], {
			listen: async (_channel: string, callback: (text: string) => void) => {
				fake.listener = callback;
			},
			notify: async (_channel: string, text: string) => {
				const wire = JSON.parse(text);
				if (wire.inline?.seq === 1) await fake.pause;
				fake.sent.push(wire.inline?.seq);
				fake.listener!(text);
			}
		})
}));
import { PgTransport } from '$lib/server/bus/pg';
import { MemoryBus } from '$lib/server/bus/memory';
import { orderedSender } from '$lib/server/bus/ordered';

const OPEN: Record<string, string> = {};
function probe(id: string, title: string, fn: () => Promise<void>) {
	const owner = OPEN[id];
	if (owner && !process.env.ADV_SHOW) it.fails(`${id} [open · ${owner}] ${title}`, fn);
	else it(`${id} ${title}`, fn);
}

beforeEach(() => {
	fake.listener = null;
	fake.pause = null;
	fake.sent = [];
});

probe(
	'R10-09',
	'two concurrent publishers: a live client still gets seq 1 then seq 2',
	async () => {
		let release!: () => void;
		fake.pause = new Promise((r) => {
			release = r;
		});
		const local = new MemoryBus();
		const transport = new PgTransport(local);
		const streamed: number[] = [];
		// As /api/events: live events go through the ordered sender; a gap is read from the op log (here: 1 and 2).
		const log = [1, 2].map((seq) => ({ kind: 'op', seq, envelope: { seq, runId: 'run' } }) as any);
		const ordered = orderedSender<{ seq: number }>({
			after: 0,
			deliver: (e) => streamed.push(e.seq),
			readAfter: async (from) => ({ events: log.filter((e) => e.seq > from), complete: true }),
			onLost: (err) => {
				throw err;
			}
		});
		local.subscribe('ws', (e: any) => {
			if ('seq' in e) ordered.push(e);
		});
		await transport.start();
		const a = transport.publish('ws', [
			{ kind: 'op', seq: 1, envelope: { seq: 1, runId: 'run' } } as never
		]);
		await transport.publish('ws', [
			{ kind: 'op', seq: 2, envelope: { seq: 2, runId: 'run' } } as never
		]);
		release();
		await a;
		await vi.waitFor(() => expect(fake.sent).toHaveLength(2));
		await ordered.idle();
		expect(streamed).toEqual([1, 2]);
	}
);
