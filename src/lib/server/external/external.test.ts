import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalCallTrace } from '$lib/core/contracts/task';
import { createBreaker, resetBreakers } from './breaker';
import { createExternalCall, RateLimited, resetExternalCache, SHORT_LIVED_MS } from './call';
import { createSpendLedger, LimitError } from './ledger';
import { withExternalScope } from './scope';

beforeEach(() => {
	resetExternalCache();
	resetBreakers();
});

describe('breaker', () => {
	it('opens after N failures, lets one probe through when half-open, closes on success', () => {
		let t = 0;
		const b = createBreaker({ failures: 2, coolS: 10, now: () => t });
		b.failure();
		expect(b.acquire()).toBeNull();
		b.failure();
		expect(b.state()).toBe('open');
		expect(b.acquire()).toBe(10);
		t = 10_001;
		expect(b.state()).toBe('half-open');
		expect(b.acquire()).toBeNull(); // the probe
		expect(b.acquire()).toBe(1); // everyone else waits for it
		b.success();
		expect(b.state()).toBe('closed');
	});

	it('a failed probe opens it again', () => {
		let t = 0;
		const b = createBreaker({ failures: 5, coolS: 10, now: () => t });
		b.trip(3);
		t = 3001;
		expect(b.acquire()).toBeNull();
		b.failure();
		expect(b.state()).toBe('open');
	});
});

describe('external call', () => {
	it('traces one ExternalCallTrace per call into the caller scope, labelled live then cache', async () => {
		const seen: { step: string; data: Record<string, unknown> }[] = [];
		const call = createExternalCall({ api: 'exa', name: 'exa-test' });
		let sent = 0;
		const send = async () => ({ value: ++sent, costUnits: 3 });
		await withExternalScope(
			{ workspaceId: 'ws-v1', trace: (step, data) => void seen.push({ step, data }) },
			async () => {
				const a = await call({ key: 'q', purpose: 'lookup_facts', maxAgeMs: 60_000 }, send);
				const b = await call({ key: 'q', purpose: 'lookup_facts', maxAgeMs: 60_000 }, send);
				expect(a).toMatchObject({ value: 1, cache: 'live' });
				expect(b).toMatchObject({ value: 1, cache: 'cache', stale: false });
			}
		);
		expect(sent).toBe(1);
		expect(seen.map((s) => s.data.cache)).toEqual(['live', 'cache']);
		for (const s of seen) {
			expect(ExternalCallTrace.safeParse(s.data).success).toBe(true);
			expect(s.data.workspaceId).toBe('ws-v1');
		}
	});

	it('charges the guard only for network calls and serves stale while rate-limited', async () => {
		const ledger = createSpendLedger();
		const guard = ledger.guard('ws-a', { perKey: 5, global: 5 });
		const call = createExternalCall({ api: 'gemini', name: 'g-test', guard });
		await call({ key: 'k', purpose: 'p' }, async () => ({ value: 'first' }));
		const r = await call({ key: 'k', purpose: 'p' }, async () => {
			throw new RateLimited(30);
		});
		expect(r).toMatchObject({ value: 'first', cache: 'cache', stale: true });
		// Open breaker, no stored answer: refused without sending or charging.
		await expect(
			call({ key: 'other', purpose: 'p' }, async () => ({ value: 'x' }))
		).rejects.toBeInstanceOf(LimitError);
		expect(ledger.usage().counts['g-test']?.keys['ws-a']).toBe(2);
	});

	it('a 4xx-style error does not open the breaker', async () => {
		const call = createExternalCall({
			api: 'valio',
			name: 'v-test',
			isOutage: () => false
		});
		for (let i = 0; i < 6; i++)
			await expect(
				call({ key: i, purpose: 'offers' }, async () => {
					throw new Error('400');
				})
			).rejects.toThrow('400');
		expect(await call({ key: 'ok', purpose: 'offers' }, async () => ({ value: 1 }))).toMatchObject({
			cache: 'live'
		});
	});
});

describe('short-lived answers', () => {
	afterEach(() => vi.useRealTimers());
	it('an empty answer is reused for minutes, not the day', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
		const call = createExternalCall({ api: 'exa', name: 'exa-short' });
		let sent = 0;
		const req = {
			key: 'empty',
			purpose: 'find_outside',
			maxAgeMs: 24 * 3_600_000,
			shortLived: (v: { options: unknown[] }) => v.options.length === 0
		};
		const send = async () => ({ value: { options: sent++ ? ['recipe'] : [] } });
		await call(req, send);
		expect((await call(req, send)).cache).toBe('cache');
		vi.setSystemTime(Date.now() + SHORT_LIVED_MS + 1000);
		expect(await call(req, send)).toMatchObject({ cache: 'live', value: { options: ['recipe'] } });
		vi.setSystemTime(Date.now() + 3_600_000);
		expect((await call(req, send)).cache).toBe('cache'); // a found answer stands for the day
		expect(sent).toBe(2);
	});
});
