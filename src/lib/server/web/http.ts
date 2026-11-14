/**
 * One HTTP call to Context.dev or Exa: cached, traced, bounded. Both providers charge for cached
 * results on their side too, so a successful response is kept here (memory, plus a directory when
 * configured) for a day by default and repeated questions cost nothing. Only a 2xx whose body the
 * caller accepts (extraction succeeded, output parsed) is cached. Every network call is charged to a
 * spend guard first; after a 429 the API cools down and a stale cached answer is served when one exists.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { logTrace, noTrace, type Trace } from '../adapters/llm/trace';
import { readJson, writeJson } from './persist';
import { WebLimitError, type SpendGuard } from './spend';

export type WebApi = 'context.dev' | 'exa';

const BASE: Record<WebApi, string> = {
	'context.dev': 'https://api.context.dev/v1',
	exa: 'https://api.exa.ai'
};

export interface WebHttpOptions {
	api: WebApi;
	apiKey: string;
	/** Directory for the response cache; memory only when absent. */
	cacheDir?: string;
	trace?: Trace;
	fetch?: typeof fetch;
	timeoutMs?: number;
	/** Charged before every network call (never for cache hits). */
	guard?: SpendGuard;
}

/** Cached answers older than this are read again unless the caller says otherwise. */
export const DEFAULT_MAX_AGE_MS = 24 * 3_600_000;
/** Cool-down after a 429 when the provider gives no Retry-After. */
export const DEFAULT_COOL_S = 60;

export interface CallOptions {
	/** Reuse a cached response younger than this; 0 = always call. Default: `DEFAULT_MAX_AGE_MS`. */
	maxAgeMs?: number;
	/** Cache the 2xx body only when this holds (e.g. the extraction succeeded). Default: always. */
	accept?: (body: unknown) => boolean;
	method?: 'GET' | 'POST' | 'PATCH';
	/** What the call is for, shown in the trace ("recall list", "facts 460002"). */
	purpose?: string;
}

export interface WebResponse<T> {
	ok: boolean;
	status: number;
	body: T;
	cached: boolean;
	latencyMs: number;
	at: string;
	/** Context.dev credits or Exa dollars, when the provider reported them. */
	cost?: { credits?: number; usd?: number };
	/** An older cached answer served because the provider is rate-limiting. */
	stale?: boolean;
}

interface Entry {
	at: string;
	status: number;
	body: unknown;
	cost?: WebResponse<unknown>['cost'];
}

const mem = new Map<string, Entry>();
/** Per API: no calls before this time (ms) after a 429. Process-wide, like the provider's limit. */
const coolUntil = new Map<WebApi, number>();

/** Test hook: forget cached answers and cool-downs. */
export function resetWebHttp() {
	mem.clear();
	coolUntil.clear();
}

export class WebError extends Error {
	constructor(
		readonly api: WebApi,
		readonly status: number,
		readonly body: unknown
	) {
		const msg =
			(body as { message?: string; error?: string })?.message ??
			(body as { error?: string })?.error ??
			'';
		super(`${api} ${status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`);
	}
}

export function createWebHttp(o: WebHttpOptions) {
	const doFetch = o.fetch ?? fetch;
	const trace = o.trace ?? noTrace;

	const keyOf = (method: string, path: string, body: unknown) =>
		createHash('sha256')
			.update(`${o.api} ${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`)
			.digest('hex')
			.slice(0, 32);

	function readCache(key: string): Entry | undefined {
		const hit = mem.get(key);
		if (hit || !o.cacheDir) return hit;
		const e = readJson<Entry | undefined>(join(o.cacheDir, `${key}.json`), undefined);
		if (e) mem.set(key, e);
		return e;
	}

	function writeCache(key: string, e: Entry) {
		mem.set(key, e);
		if (o.cacheDir) writeJson(join(o.cacheDir, `${key}.json`), e);
	}

	return async function call<T>(
		path: string,
		body?: unknown,
		c: CallOptions = {}
	): Promise<WebResponse<T>> {
		const method = c.method ?? (body === undefined ? 'GET' : 'POST');
		const key = keyOf(method, path, body);
		const maxAge = c.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
		const cachedEntry = readCache(key);
		const fromCache = (hit: Entry, stale: boolean): WebResponse<T> => {
			const data = {
				source: o.api,
				model: path,
				purpose: c.purpose,
				cache: stale ? 'stale' : 'hit',
				latencyMs: 0
			};
			trace('tool', data);
			logTrace(data);
			return {
				ok: true,
				status: hit.status,
				body: hit.body as T,
				cached: true,
				latencyMs: 0,
				at: hit.at,
				cost: hit.cost,
				...(stale ? { stale: true } : {})
			};
		};
		if (maxAge > 0 && cachedEntry && Date.now() - Date.parse(cachedEntry.at) <= maxAge)
			return fromCache(cachedEntry, false);

		// Rate-limited: answer from an older cache entry, or refuse without calling (no 503 storm).
		const cool = coolUntil.get(o.api) ?? 0;
		if (cool > Date.now()) {
			if (cachedEntry) return fromCache(cachedEntry, true);
			throw new WebLimitError('rate-limit', o.api, Math.ceil((cool - Date.now()) / 1000));
		}
		o.guard?.charge(o.api);

		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (o.api === 'exa') headers['x-api-key'] = o.apiKey;
		else headers.authorization = `Bearer ${o.apiKey}`;

		const t0 = performance.now();
		let res: Response | undefined;
		let attempt = 0;
		// One bounded retry on 429/5xx (Context.dev applies a per-minute limit to this key).
		while (true) {
			res = await doFetch(BASE[o.api] + path, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(o.timeoutMs ?? 60_000)
			});
			if ((res.status === 429 || res.status >= 500) && attempt < 1) {
				attempt++;
				const wait = Math.min(retryAfterS(res, 2) * 1000, 8000);
				await new Promise((r) => setTimeout(r, wait));
				continue;
			}
			break;
		}
		const latencyMs = Math.round(performance.now() - t0);
		const text = await res.text();
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = { message: text.slice(0, 300) };
		}
		const credits = Number(res.headers.get('x-credits-used') ?? NaN);
		const usd = (parsed as { costDollars?: { total?: number } })?.costDollars?.total;
		const cost = {
			...(Number.isFinite(credits) ? { credits } : {}),
			...(typeof usd === 'number' ? { usd } : {})
		};
		const at = new Date().toISOString();
		const data = {
			source: o.api,
			model: path,
			purpose: c.purpose,
			cache: 'miss',
			status: res.status,
			latencyMs,
			...cost,
			...(res.ok ? {} : { error: `HTTP ${res.status}` })
		};
		trace(res.ok ? 'tool' : 'error', data);
		logTrace(data);
		if (res.status === 429) {
			const s = retryAfterS(res, DEFAULT_COOL_S);
			coolUntil.set(o.api, Date.now() + s * 1000);
			if (cachedEntry) return fromCache(cachedEntry, true);
			throw new WebLimitError('rate-limit', o.api, s);
		}
		if (!res.ok) throw new WebError(o.api, res.status, parsed);
		if (!c.accept || c.accept(parsed))
			writeCache(key, { at, status: res.status, body: parsed, cost });
		return { ok: true, status: res.status, body: parsed as T, cached: false, latencyMs, at, cost };
	};
}

function retryAfterS(res: Response, fallback: number): number {
	const n = Number(res.headers.get('retry-after'));
	return Number.isFinite(n) && n > 0 ? Math.ceil(n) : fallback;
}

export type WebCall = ReturnType<typeof createWebHttp>;
