import { afterEach, describe, expect, it } from 'vitest';
import { createFixtureDb } from '../db/pglite';
import { withExternalScope } from '../external/scope';
import { logTrace } from '../adapters/llm/trace';
import type { AnyDb } from '../store/drizzle-store';
import { annotateRequest, currentRequest, requestIdFrom, withRequest } from './context';
import { entry, jsonLine, log, MAX_LINE, setLogSink, type LogEntry } from './log';
import { capJson, redact } from './redact';
import { parseSince, readAccess, toTraceEvent, toView } from './read';
import { createTraceStore, type TraceStore } from './trace-store';
import {
	enqueue,
	flushTraces,
	recordTrace,
	RETAIN_MS,
	setTraceStore,
	toTraceRow,
	traceWriterStatus
} from './traces';

const NL = String.fromCharCode(10);
const tick = () => new Promise((r) => setTimeout(r, 5));

async function pgStore(): Promise<TraceStore> {
	const { db } = await createFixtureDb();
	return createTraceStore(db as unknown as AnyDb);
}

afterEach(() => {
	setTraceStore(null);
	setLogSink();
});

describe('request id', () => {
	it('keeps a plain incoming id and replaces anything else', () => {
		expect(requestIdFrom('abc-123.x:y')).toBe('abc-123.x:y');
		expect(requestIdFrom('has space')).toMatch(/^req-/);
		expect(requestIdFrom('x'.repeat(65))).toMatch(/^req-/);
		expect(requestIdFrom(null)).toMatch(/^req-[\w-]{18}$/);
	});

	it('survives async boundaries and stays per request', async () => {
		const seen: string[] = [];
		const one = async (id: string) =>
			withRequest({ requestId: id }, async () => {
				await tick();
				await Promise.resolve().then(tick);
				await new Promise<void>((r) => setImmediate(r));
				seen.push(currentRequest()!.requestId);
				// A log line written deep inside picks the id up without being passed it.
				return entry('info', 'x').requestId;
			});
		const [a, b] = await Promise.all([one('req-a'), one('req-b')]);
		expect([a, b]).toEqual(['req-a', 'req-b']);
		expect(seen.sort()).toEqual(['req-a', 'req-b']);
		expect(currentRequest()).toBeUndefined();
	});

	it('annotations fill gaps and never overwrite the first value', () =>
		withRequest({ requestId: 'r1' }, async () => {
			annotateRequest({ workspaceId: 'ws-a', actor: { kind: 'agent', id: 'k1' } });
			await tick();
			annotateRequest({ workspaceId: 'ws-b', runId: 'run-2' });
			expect(currentRequest()).toMatchObject({
				workspaceId: 'ws-a',
				runId: 'run-2',
				actor: { id: 'k1' }
			});
		}));
});

describe('logger redaction', () => {
	it('blanks secrets, drops bodies and scrubs credential shapes', () => {
		const e = entry('info', 'tool.call', {
			apiKey: 'AIzaSyD-very-secret-key-000000000000',
			authorization: 'Bearer abc.def.ghi',
			cookie: 'mandate_visitor=xyz',
			prompt: 'my secret prompt',
			messages: [{ role: 'user', content: 'hi' }],
			tokensIn: 12,
			maxTokens: 400,
			note: 'called https://x.test/v1?key=AIzaSyD-very-secret-key-000000000000&q=milk',
			db: 'postgres://user:pw@host:5432/db',
			error: 'auth failed for Bearer sk-abcdefghijklmnopqrstu'
		});
		const line = JSON.stringify(e);
		expect(line).not.toMatch(/very-secret|abc\.def|xyz|my secret prompt|user:pw|sk-abcdef/);
		expect(e).not.toHaveProperty('prompt');
		expect(e).not.toHaveProperty('messages');
		expect(e).toMatchObject({ apiKey: '[redacted]', tokensIn: 12, maxTokens: 400 });
		expect(e.note).toContain('key=[redacted]&q=milk');
		expect(e.db).toBe('postgres://[redacted]');
	});

	it('writes through the sink with context and keeps its envelope keys', () =>
		withRequest({ requestId: 'req-log' }, async () => {
			const got: LogEntry[] = [];
			setLogSink((x) => got.push(x));
			await withExternalScope({ workspaceId: 'ws-x', runId: 'run-9' }, async () =>
				log.warn('bus.event_dropped', { event: 'spoof', requestId: 'spoof', kind: 'trace' })
			);
			expect(got).toHaveLength(1);
			expect(got[0]).toMatchObject({
				level: 'warn',
				event: 'bus.event_dropped',
				requestId: 'req-log',
				workspaceId: 'ws-x',
				runId: 'run-9',
				kind: 'trace'
			});
		}));

	it('ships one flat JSON line per entry, under the size cap', () =>
		withRequest({ requestId: 'req-j', route: '/api/tools/[name]' }, async () => {
			const e = entry('error', 'tool.threw', {
				tool: 'quote_lines',
				error: `line one${NL}line two`,
				who: { kind: 'agent', id: 'k1' },
				lines: [1, 2, 3]
			});
			const line = jsonLine(e);
			expect(line).not.toContain(NL);
			const o = JSON.parse(line);
			expect(Object.keys(o).slice(0, 5)).toEqual(['at', 'level', 'event', 'requestId', 'route']);
			expect(o).toMatchObject({
				route: '/api/tools/[name]',
				'who.kind': 'agent',
				'who.id': 'k1',
				lines: '[1,2,3]',
				error: `line one${NL}line two`
			});
			const huge = jsonLine(
				entry(
					'info',
					'x',
					Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'y'.repeat(450)]))
				)
			);
			expect(huge.length).toBeLessThanOrEqual(MAX_LINE);
			expect(JSON.parse(huge)).toMatchObject({ truncated: true, event: 'x', requestId: 'req-j' });
		}));

	it('caps stored data size', () => {
		const big = capJson({ rows: Array.from({ length: 50 }, (_, i) => 'x'.repeat(400) + i) }, 4096);
		expect(JSON.stringify(big).length).toBeLessThanOrEqual(4096);
		expect(big.truncated).toBe(true);
		expect(redact({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
			a: { b: { c: { d: '[nested]' } } }
		});
	});
});

describe('persisted traces (PGlite)', () => {
	it('stores a model call with the request, scope and redacted data', async () => {
		const store = await pgStore();
		setTraceStore(store);
		await withRequest({ requestId: 'req-p1', via: 'mcp' }, () =>
			withExternalScope(
				{ workspaceId: 'ws-demo', runId: 'run-1', actor: { kind: 'agent', id: 'key-1' } },
				async () => {
					logTrace(
						{
							api: 'gemini',
							source: 'gemini',
							purpose: 'decide.fit',
							cache: 'live',
							ok: true,
							model: 'gemini-3.5-flash-lite',
							tokensIn: 120,
							tokensOut: 30,
							latencyMs: 812.4,
							costUnits: 150,
							prompt: 'never stored',
							apiKey: 'AIzaSyD-very-secret-key-000000000000'
						},
						'text'
					);
				}
			)
		);
		await flushTraces();
		const rows = await store.list({ requestId: 'req-p1' });
		expect(rows).toHaveLength(1);
		const v = toView(rows[0]);
		expect(v).toMatchObject({
			requestId: 'req-p1',
			workspaceId: 'ws-demo',
			runId: 'run-1',
			actor: { kind: 'agent', id: 'key-1' },
			via: 'mcp',
			step: 'text',
			source: 'gemini',
			model: 'gemini-3.5-flash-lite',
			tokensIn: 120,
			tokensOut: 30,
			latencyMs: 812,
			cache: 'live',
			ok: true,
			costUnits: 150
		});
		expect(v.data).toMatchObject({ purpose: 'decide.fit', apiKey: '[redacted]' });
		expect(JSON.stringify(v.data)).not.toContain('never stored');
		const ev = toTraceEvent(v);
		expect(ev).toMatchObject({ kind: 'trace', step: 'text', workspaceId: 'ws-demo' });
		expect(ev.data).toMatchObject({ source: 'gemini', persisted: true, actor: 'key-1' });
	});

	it('filters, and summarises per source with percentiles, errors and cache hits', async () => {
		const store = await pgStore();
		setTraceStore(store);
		const at = Date.now();
		const rows = [
			...[100, 200, 300, 400, 1000].map((ms, i) => ({
				source: 'valio',
				latencyMs: ms,
				cache: i < 2 ? 'cache' : 'live',
				ok: i !== 4
			})),
			{ source: 'tool', tool: 'quote_lines', latencyMs: 5, ok: true }
		];
		for (const [i, d] of rows.entries())
			enqueue(
				toTraceRow(
					d.ok ? 'tool' : 'error',
					{ ...d, workspaceId: i % 2 ? 'ws-a' : 'ws-b' },
					new Date(at - i * 1000)
				)
			);
		await flushTraces();
		const sum = await store.summary({});
		const valio = sum.find((s) => s.source === 'valio')!;
		expect(valio).toMatchObject({ count: 5, p50Ms: 300, errorRate: 0.2, cacheHitRate: 0.4 });
		expect(valio.p95Ms).toBeGreaterThan(400);
		// Two from the cache, three live of which one failed: two live successes, never five.
		expect(valio.byMode).toEqual({ live: 3, cache: 2, replay: 0, fixture: 0, none: 0 });
		expect(valio.liveOk).toBe(2);
		expect(sum.find((s) => s.source === 'tool')!.byMode.none).toBe(1);
		expect(sum.find((s) => s.source === 'tool')!.count).toBe(1);
		expect(await store.list({ source: 'valio', workspaceId: 'ws-a' })).toHaveLength(2);
		expect(await store.list({ since: new Date(at + 60_000).toISOString() })).toHaveLength(0);
	});

	it('summarises one run of a workspace (the Engine room Valio count)', async () => {
		const store = await pgStore();
		setTraceStore(store);
		const at = Date.now();
		for (const [i, runId] of ['run-a', 'run-a', 'run-b'].entries())
			enqueue(
				toTraceRow(
					'tool',
					{
						source: 'valio',
						cache: i === 1 ? 'cache' : 'live',
						ok: true,
						latencyMs: 5,
						workspaceId: 'ws-r',
						runId
					},
					new Date(at - i * 1000)
				)
			);
		await flushTraces();
		const [v] = await store.summary({ workspaceId: 'ws-r', runId: 'run-a', source: 'valio' });
		expect(v).toMatchObject({ count: 2, byMode: { live: 1, cache: 1 } });
	});

	it('prunes rows older than the retention on a flush', async () => {
		const store = await pgStore();
		setTraceStore(store);
		const now = new Date();
		enqueue(
			toTraceRow('tool', { source: 'exa', ok: true }, new Date(now.getTime() - RETAIN_MS - 60_000))
		);
		enqueue(toTraceRow('tool', { source: 'exa', ok: true }, new Date(now.getTime() - 60_000)));
		await flushTraces(() => now);
		const left = await store.list({ since: new Date(now.getTime() - RETAIN_MS * 2).toISOString() });
		expect(left).toHaveLength(1);
		expect(new Date(left[0].at).getTime()).toBeGreaterThan(now.getTime() - RETAIN_MS);
	});

	it('never throws or blocks when the database is down, and catches up after', async () => {
		const real = await pgStore();
		let down = true;
		setTraceStore({
			...real,
			insert: async (r) => {
				if (down) throw new Error('connection refused');
				return real.insert(r);
			}
		});
		const warned: LogEntry[] = [];
		setLogSink((e) => warned.push(e));
		expect(() => recordTrace('tool', { source: 'exa', ok: true })).not.toThrow();
		await flushTraces();
		expect(traceWriterStatus()).toMatchObject({ queued: 1, failing: true });
		expect(warned.map((w) => w.event)).toContain('trace.write_failed');
		down = false;
		await flushTraces();
		expect(traceWriterStatus()).toMatchObject({ queued: 0, failing: false });
		expect(await real.list({})).toHaveLength(1);
	});
});

describe('read access', () => {
	const cookies = { get: () => undefined } as never;
	const env = { NODE_ENV: 'production' };

	it('lets a visitor read the public rooms only, and the presenter everything', () => {
		const u = (q: string) => new URL(`http://x/api/ops/traces?${q}`);
		expect(readAccess(u('ws=ws-demo'), cookies, env, false)).toMatchObject({ ok: true });
		expect(readAccess(u('ws=ws-someone-else'), cookies, env, false)).toMatchObject({
			ok: false,
			status: 403
		});
		expect(readAccess(u('ws=bad%20id'), cookies, env, false)).toMatchObject({
			ok: false,
			status: 400
		});
		// Without ws, a visitor reads their own room (the stage when they have none).
		const own = readAccess(u(''), cookies, env, false);
		expect(own.ok && own.filter.workspaceId).toBe('ws-demo');
		const devAll = readAccess(u('source=gemini'), cookies, env, true);
		expect(devAll.ok && devAll.filter).toMatchObject({ source: 'gemini' });
		expect(devAll.ok && devAll.filter.workspaceId).toBeUndefined();
	});

	it('parses since as relative, ISO or default, bounded by retention', () => {
		const now = new Date('2026-11-14T12:00:00Z');
		expect(parseSince('15m', now)).toBe('2026-11-14T11:45:00.000Z');
		expect(parseSince(null, now)).toBe('2026-11-14T11:00:00.000Z');
		expect(parseSince('2026-11-14T10:00:00Z', now)).toBe('2026-11-14T10:00:00.000Z');
		expect(parseSince('30d', now)).toBe('2026-11-07T12:00:00.000Z');
	});
});
