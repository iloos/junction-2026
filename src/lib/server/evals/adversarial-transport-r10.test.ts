/* eslint-disable @typescript-eslint/no-explicit-any -- the fake SQL driver mimics postgres.js loosely */
/**
 * Adversarial regression, round 10 transport (R10-09): two post-commit publishers on the real `PgTransport` with a
 * faked NOTIFY that delays seq 1. Every op must still reach a live client once, in sequence, through the same
 * high-water filter /api/events applies. Open under 9c as `it.fails` until fixed; `ADV_SHOW=1` runs it plainly.
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

const OPEN: Record<string, string> = { 'R10-09': '9c' };
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
		let last = 0;
		local.subscribe('ws', (e: any) => {
			if ('seq' in e && e.seq > last) {
				last = e.seq;
				streamed.push(e.seq);
			}
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
		await new Promise((r) => setTimeout(r, 50));
		expect(streamed).toEqual([1, 2]);
	}
);
