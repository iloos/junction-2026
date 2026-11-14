import { beforeEach, describe, expect, it } from 'vitest';
import { breakerFor, resetBreakers } from './breaker';
import { logTrace } from '../adapters/llm/trace';
import { registerBreaker, resetServiceStatus, serviceStatus, servicesStatus } from './status';

beforeEach(() => {
	resetServiceStatus();
	resetBreakers();
});

const t0 = Date.parse('2026-12-07T19:40:00Z');

describe('service status', () => {
	it('is idle until a service is called, never assumed', () => {
		expect(servicesStatus(t0).map((s) => s.mode)).toEqual(['idle', 'idle', 'idle', 'idle']);
		expect(serviceStatus('valio', t0).lastLive).toBeNull();
	});

	it('reads the source of the latest call, and the age of the last live one', () => {
		logTrace({ api: 'valio', purpose: 'offers', cache: 'live', ok: true, latencyMs: 80 });
		const live = serviceStatus('valio');
		expect(live.mode).toBe('live');
		expect(live.lastLive?.ok).toBe(true);
		logTrace({ api: 'valio', purpose: 'offers', cache: 'cache', ok: true, latencyMs: 0 });
		const s = serviceStatus('valio', Date.now() + 90_000);
		expect(s.mode).toBe('cache');
		expect(s.lastLive?.ageS).toBeGreaterThanOrEqual(89);
		expect(s.recent).toEqual({ live: 1, cache: 1 });
	});

	it("tells Decide's replay from its rules", () => {
		logTrace({
			api: 'gemini',
			purpose: 'decide.fit',
			cache: 'replay',
			ok: true,
			latencyMs: 0,
			source: 'replay'
		});
		expect(serviceStatus('gemini').mode).toBe('replay');
		logTrace({
			api: 'gemini',
			purpose: 'decide.fit',
			cache: 'fixture',
			ok: true,
			latencyMs: 0,
			source: 'rules',
			model: 'rules'
		});
		expect(serviceStatus('gemini').mode).toBe('rules');
	});

	it('says failing after a failed live call, and breaker_open while a breaker is open', () => {
		logTrace({
			api: 'exa',
			purpose: 'search',
			cache: 'live',
			ok: false,
			latencyMs: 30,
			error: 'HTTP 500'
		});
		expect(serviceStatus('exa')).toMatchObject({
			mode: 'failing',
			last: { error: 'HTTP 500' },
			recent: { failed: 1 }
		});
		breakerFor('exa').trip(60);
		expect(serviceStatus('exa')).toMatchObject({ mode: 'breaker_open', breaker: 'open' });
		breakerFor('context.dev').trip(60);
		expect(serviceStatus('contextdev').breaker).toBe('open');
	});

	it("reads Valio's own breaker", () => {
		let state: 'closed' | 'open' | 'half_open' = 'closed';
		registerBreaker('valio', () => state);
		expect(serviceStatus('valio').breaker).toBe('closed');
		state = 'open';
		expect(serviceStatus('valio').mode).toBe('breaker_open');
		state = 'half_open';
		expect(serviceStatus('valio').breaker).toBe('half-open');
	});

	it('ignores log lines that are not outside calls', () => {
		logTrace({ source: 'planner', model: 'x', latencyMs: 3 });
		logTrace({ api: 'featherless', cache: 'live', ok: true, latencyMs: 3 });
		expect(servicesStatus().every((s) => s.mode === 'idle')).toBe(true);
	});
});
