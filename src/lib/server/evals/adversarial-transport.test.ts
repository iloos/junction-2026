/* eslint-disable @typescript-eslint/no-explicit-any -- the fake SQL driver mimics postgres.js loosely */
/**
 * Adversarial regression suite, Postgres transport (docs/review/ROUND9-ADVERSARIAL.md R9-09, R9-10), on the real
 * `PgTransport` with a faked SQL/NOTIFY driver. Same convention as adversarial.test.ts: each case asserts the correct
 * behaviour; an open one runs as `it.fails` until its owner fixes it and deletes its OPEN line. `ADV_SHOW=1` runs all
 * cases plainly.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
	listener: null as null | ((text: string) => void),
	read: Promise.resolve([]) as Promise<any[]>,
	sent: [] as string[]
}));
vi.mock('$lib/server/db/client', () => ({
	sql: () =>
		Object.assign(async () => fake.read, {
			listen: async (_channel: string, callback: (text: string) => void) => {
				fake.listener = callback;
			},
			notify: async (_channel: string, text: string) => {
				fake.sent.push(text);
				if (Buffer.byteLength(text, 'utf8') >= 8000)
					throw new Error('payload exceeds NOTIFY byte limit');
			}
		})
}));
import { PgTransport } from '$lib/server/bus/pg';
import { MemoryBus } from '$lib/server/bus/memory';

/** Open defects: id → owner (9c = runtime/transport). Delete a line when its case goes red ("looks fixed"). */
const OPEN: Record<string, string> = {};
function probe(id: string, title: string, fn: () => Promise<void>) {
	const owner = OPEN[id];
	if (owner && !process.env.ADV_SHOW) it.fails(`${id} [open · ${owner}] ${title}`, fn);
	else it(`${id} ${title}`, fn);
}

beforeEach(() => {
	fake.listener = null;
	fake.read = Promise.resolve([]);
	fake.sent = [];
});

probe(
	'R9-09',
	'a slow referenced op still reaches a live client before the next one, once, in order',
	async () => {
		let release!: (rows: any[]) => void;
		fake.read = new Promise((resolve) => {
			release = resolve;
		});
		const local = new MemoryBus();
		const transport = new PgTransport(local);
		const arrived: number[] = [];
		const streamed: number[] = [];
		let last = 0;
		// The same high-water filter /api/events applies.
		local.subscribe('ws', (e: any) => {
			if ('seq' in e) {
				arrived.push(e.seq);
				if (e.seq > last) {
					last = e.seq;
					streamed.push(e.seq);
				}
			}
		});
		await transport.start();
		fake.listener!(JSON.stringify({ ws: 'ws', ref: { kind: 'op', seq: 1 } }));
		fake.listener!(
			JSON.stringify({
				ws: 'ws',
				inline: { kind: 'op', seq: 2, envelope: { seq: 2, runId: 'run' } }
			})
		);
		release([{ envelope: { seq: 1, runId: 'run' } }]);
		await vi.waitFor(() => expect(arrived).toHaveLength(2));
		expect(streamed).toEqual([1, 2]);
	}
);

probe(
	'R9-10',
	'a multilingual event over the NOTIFY byte limit is sent by reference, not refused',
	async () => {
		const transport = new PgTransport(new MemoryBus());
		const event = {
			kind: 'trace',
			workspaceId: 'ws',
			runId: 'run',
			step: 'text',
			data: { text: '界'.repeat(3000) }
		};
		await expect(transport.publish('ws', [event as never])).resolves.not.toThrow();
		for (const wire of fake.sent) expect(Buffer.byteLength(wire, 'utf8')).toBeLessThan(8000);
	}
);
