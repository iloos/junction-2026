import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A fake Postgres driver: LISTEN hands us the callback, NOTIFY enforces the real 8000-byte limit. */
const fake = vi.hoisted(() => ({
	listener: null as null | ((text: string) => void),
	reads: [] as Promise<unknown[]>[],
	sent: [] as string[]
}));
vi.mock('$lib/server/db/client', () => ({
	sql: () =>
		Object.assign(async () => fake.reads.shift() ?? [], {
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

import { MemoryBus } from './memory';
import { PgTransport } from './pg';

beforeEach(() => {
	fake.listener = null;
	fake.reads = [];
	fake.sent = [];
});

const op = (seq: number, extra: Record<string, unknown> = {}) =>
	({ kind: 'op', seq, envelope: { seq, runId: 'run', ...extra } }) as never;

describe('Postgres transport', () => {
	it('R9-09: a referenced op fetched slowly is not overtaken by a later inline one', async () => {
		let release!: (rows: unknown[]) => void;
		fake.reads.push(new Promise((r) => (release = r)));
		const local = new MemoryBus();
		const t = new PgTransport(local);
		const arrived: number[] = [];
		const streamed: number[] = [];
		let last = 0;
		// The same high-water filter /api/events applies.
		local.subscribe('ws', (e) => {
			if (!('seq' in e)) return;
			arrived.push(e.seq);
			if (e.seq > last) {
				last = e.seq;
				streamed.push(e.seq);
			}
		});
		await t.start();
		fake.listener!(JSON.stringify({ ws: 'ws', ref: { kind: 'op', seq: 1 } }));
		fake.listener!(JSON.stringify({ ws: 'ws', inline: op(2) }));
		fake.listener!(JSON.stringify({ ws: 'other', inline: op(7) }));
		await new Promise((r) => setTimeout(r, 10));
		expect(arrived).toEqual([]);
		release([{ envelope: { seq: 1, runId: 'run' } }]);
		await vi.waitFor(() => expect(arrived).toHaveLength(2));
		expect(arrived).toEqual([1, 2]);
		expect(streamed).toEqual([1, 2]);
	});

	it('keeps going after a notification that fails to load', async () => {
		fake.reads.push(Promise.reject(new Error('db down')));
		const local = new MemoryBus();
		const t = new PgTransport(local);
		const arrived: number[] = [];
		local.subscribe('ws', (e) => 'seq' in e && arrived.push(e.seq));
		await t.start();
		fake.listener!(JSON.stringify({ ws: 'ws', ref: { kind: 'op', seq: 1 } }));
		fake.listener!(JSON.stringify({ ws: 'ws', inline: op(2) }));
		await vi.waitFor(() => expect(arrived).toEqual([2]));
	});

	it('R9-10: measures the NOTIFY limit in UTF-8 bytes', async () => {
		const t = new PgTransport(new MemoryBus());
		// 3,000 CJK characters: about 3,100 characters on the wire but over 9,000 bytes.
		const trace = {
			kind: 'trace',
			workspaceId: 'ws',
			runId: 'run',
			step: 'text',
			data: { text: '界'.repeat(3000) }
		};
		await expect(t.publish('ws', [trace as never])).resolves.toBeUndefined();
		expect(fake.sent).toEqual([]);
		// "ä" is two bytes: 3,600 of them (7,200 bytes) go by reference, 3,300 (6,600 bytes) go inline.
		await t.publish('ws', [op(3, { note: 'ä'.repeat(3600) })]);
		await t.publish('ws', [op(4, { note: 'ä'.repeat(3300) })]);
		expect(JSON.parse(fake.sent[0])).toEqual({ ws: 'ws', ref: { kind: 'op', seq: 3 } });
		expect(JSON.parse(fake.sent[1])).toHaveProperty('inline');
		for (const text of fake.sent) expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(8000);
	});
});
