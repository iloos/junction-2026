import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createContextDev } from './contextdev';
import { createExa, shapeStructured } from './exa';
import { createWebHttp, DEFAULT_MAX_AGE_MS, resetWebHttp } from './http';
import { enrichmentValue, FactsContent, mentionsGtin, OutsideContent } from './lookup';
import { providerFail } from './route';
import { createSpendLedger, spendLimits, WebLimitError } from './spend';

/** A fetch that answers from a list of responses (last one repeats) and counts calls. */
function fakeFetch(
	...answers: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
	const calls: string[] = [];
	const f = (async (url: string) => {
		const a = answers[Math.min(calls.length, answers.length - 1)];
		calls.push(String(url));
		return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: a.headers });
	}) as unknown as typeof fetch;
	return { f, calls };
}

beforeEach(() => resetWebHttp());
afterEach(() => vi.useRealTimers());

describe('F28 response cache', () => {
	it('caches a 2xx only when the caller accepts the body', async () => {
		const { f, calls } = fakeFetch({ body: { ok: false } });
		const call = createWebHttp({ api: 'exa', apiKey: 'k', fetch: f });
		await call('/search', { q: 1 }, { accept: () => false });
		await call('/search', { q: 1 }, { accept: () => false });
		expect(calls).toHaveLength(2);
		await call('/search', { q: 2 }, { accept: () => true });
		const hit = await call('/search', { q: 2 }, { accept: () => true });
		expect(calls).toHaveLength(3);
		expect(hit.cached).toBe(true);
	});

	it('a cached answer expires after the default max age (finite)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
		const { f, calls } = fakeFetch({ body: { results: [] } });
		const call = createWebHttp({ api: 'exa', apiKey: 'k', fetch: f });
		await call('/search', { q: 'age' });
		vi.setSystemTime(Date.now() + DEFAULT_MAX_AGE_MS - 1000);
		expect((await call('/search', { q: 'age' })).cached).toBe(true);
		vi.setSystemTime(Date.now() + 2000);
		expect((await call('/search', { q: 'age' })).cached).toBe(false);
		expect(calls).toHaveLength(2);
	});

	it('a Context.dev extraction that failed (2xx, success false) is not cached', async () => {
		const { f, calls } = fakeFetch({
			body: { json: { success: false, data: null, error_code: 'EXTRACTION_FAILED' } }
		});
		const cd = createContextDev(createWebHttp({ api: 'context.dev', apiKey: 'k', fetch: f }));
		const url = 'https://www.ruokavirasto.fi/x/takaisinvedot-2023-/a/';
		await expect(cd.readNotice(url)).rejects.toThrow(/could not extract/);
		await expect(cd.readNotice(url)).rejects.toThrow(/could not extract/);
		expect(calls).toHaveLength(2);
	});
});

describe('F28 Exa runtime schema', () => {
	it('drops malformed results and citations, keeps the rest', () => {
		const s = shapeStructured(
			{
				results: [
					{ url: 'https://a.fi/p', title: 'A', highlights: ['Ainesosat: x'] },
					{ url: 'not a url', title: 'B' },
					{ title: 'no url' }
				],
				output: {
					content: {
						allergens: ['maito'],
						mayContain: 'oops',
						netContent: 5,
						origin: ' ',
						ingredients: 'x'
					},
					grounding: [
						{
							field: 'allergens',
							citations: [{ url: 'https://a.fi/p' }, { url: 'bad' }],
							confidence: 'high'
						},
						{ nofield: true }
					]
				}
			},
			FactsContent
		);
		expect(s.results.map((r) => r.url)).toEqual(['https://a.fi/p']);
		expect(s.grounding).toHaveLength(1);
		expect(s.content).toEqual({
			allergens: ['maito'],
			mayContain: null,
			netContent: null,
			origin: null,
			ingredients: 'x'
		});
	});

	it('content that fails its schema is null with a reason, and is not cached', async () => {
		const { f, calls } = fakeFetch({
			body: { results: [], output: { content: 'a string', grounding: [] } }
		});
		const exa = createExa(createWebHttp({ api: 'exa', apiKey: 'k', fetch: f }));
		const q = {
			key: 'k1',
			query: 'q',
			systemPrompt: 's',
			schema: {},
			parse: z.object({ a: z.string() })
		};
		const r = await exa.structured(q);
		expect(r.content).toBeNull();
		expect(r.invalid).toBeTruthy();
		await exa.structured(q);
		expect(calls).toHaveLength(2);
	});

	it('outside options keep their grounding index when one fails its schema', () => {
		const s = shapeStructured(
			{
				output: {
					content: {
						options: [{ kind: 'recipe' }, { title: 'Torttu', kind: 'x', ingredients: ['jauho'] }]
					}
				}
			},
			OutsideContent
		);
		expect(s.content?.options[0]).toBeNull();
		expect(s.content?.options[1]).toMatchObject({
			title: 'Torttu',
			kind: 'recipe',
			ingredients: ['jauho']
		});
	});

	it('gtinCited is a whole-number text match, and the enrichment keeps `verified` as an alias', () => {
		expect(mentionsGtin('ean 6416796729140 tuote', '6416796729140')).toBe(true);
		expect(mentionsGtin('id 96416796729140', '6416796729140')).toBe(false);
		expect(mentionsGtin('x', undefined)).toBe(false);
		const v = enrichmentValue({
			value: ['maito'],
			gtinCited: true,
			sources: [{ url: 'https://a.fi', gtinCited: true }]
		});
		expect(v).toEqual({
			value: ['maito'],
			gtinCited: true,
			verified: 'gtin',
			sources: ['https://a.fi']
		});
		expect(enrichmentValue({ value: 1, gtinCited: false, sources: [] }).verified).toBe('name');
	});
});

describe('spend caps', () => {
	const clock = { now: new Date('2026-11-14T23:00:00Z') };
	const ledger = () => createSpendLedger(undefined, () => clock.now);

	it('caps each caller key per day, and resets at UTC midnight', () => {
		const l = ledger();
		const a = l.guard('chef:judge-1', { perKey: 2, global: 10 });
		a.charge('exa');
		a.charge('exa');
		const e = (() => {
			try {
				a.charge('exa');
			} catch (x) {
				return x as WebLimitError;
			}
		})();
		expect(e).toBeInstanceOf(WebLimitError);
		expect(e).toMatchObject({ reason: 'cap-key', retryAfterS: 3600 });
		l.guard('chef:judge-2', { perKey: 2, global: 10 }).charge('exa'); // another key still works
		a.charge('context.dev'); // caps are per API
		clock.now = new Date('2026-11-15T00:00:01Z');
		a.charge('exa');
		expect(l.usage().counts.exa?.keys['chef:judge-1']).toBe(1);
	});

	it('the global cap stops every caller, the monitor included', () => {
		const l = ledger();
		l.guard('chef:a', { perKey: 5, global: 2 }).charge('context.dev');
		l.guard(null, { perKey: 5, global: 2 }).charge('context.dev');
		expect(() => l.guard('chef:b', { perKey: 5, global: 2 }).charge('context.dev')).toThrow(
			/global cap/
		);
		expect(() => l.guard(null, { perKey: 5, global: 2 }).charge('context.dev')).toThrow(
			WebLimitError
		);
	});

	it('limits come from the env with safe defaults', () => {
		expect(spendLimits({})).toEqual({ perKey: 30, global: 300 });
		expect(spendLimits({ WEB_CAP_PER_KEY: '5', WEB_CAP_GLOBAL: 'x' })).toEqual({
			perKey: 5,
			global: 300
		});
	});

	it('cache hits are free; a cap reached never calls the provider', async () => {
		const { f, calls } = fakeFetch({ body: { results: [] } });
		const guard = ledger().guard('chef:a', { perKey: 1, global: 10 });
		const call = createWebHttp({ api: 'exa', apiKey: 'k', fetch: f, guard });
		await call('/search', { q: 'free' });
		await call('/search', { q: 'free' }); // hit
		await expect(call('/search', { q: 'other' })).rejects.toBeInstanceOf(WebLimitError);
		expect(calls).toHaveLength(1);
	});
});

describe('Context.dev 429', { timeout: 15_000 }, () => {
	it('cools down after a 429: later clicks do not call, and get 429 with Retry-After (not 503)', async () => {
		const { f, calls } = fakeFetch({
			status: 429,
			body: { message: 'slow down' },
			headers: { 'retry-after': '1' }
		});
		const call = createWebHttp({ api: 'context.dev', apiKey: 'k', fetch: f });
		const first = await call('/web/scrape', { url: 'a' }).catch((e) => e);
		expect(first).toBeInstanceOf(WebLimitError);
		expect(calls).toHaveLength(2); // one bounded retry
		const again = await call('/web/scrape', { url: 'b' }).catch((e) => e);
		expect(again).toMatchObject({ reason: 'rate-limit' });
		expect(calls).toHaveLength(2); // cooling: no call sent
		const res = providerFail(again);
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe(String(again.retryAfterS));
		expect(await res.json()).toMatchObject({ error: { code: 'RATE_LIMITED', retryable: true } });
	});

	it('serves an older cached answer, marked stale, while rate-limited', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
		const ok = { body: { json: { success: true, data: { recalls: [] } } } };
		const limited = { status: 429, body: {}, headers: { 'retry-after': '1' } };
		const { f } = fakeFetch(ok, limited);
		const call = createWebHttp({ api: 'context.dev', apiKey: 'k', fetch: f });
		await call('/web/scrape', { url: 'list' });
		const r = await call('/web/scrape', { url: 'list' }, { maxAgeMs: 0 });
		expect(r).toMatchObject({ cached: true, stale: true, body: ok.body });
	});
});
