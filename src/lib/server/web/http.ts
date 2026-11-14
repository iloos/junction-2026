/**
 * One HTTP call to Context.dev or Exa, on the shared outside-call helper (`external/call.ts`): cached,
 * traced, charged, behind a breaker. Both providers charge for cached results on their side too, so a
 * successful response is kept (memory, plus a directory when configured) for a day by default and repeated
 * questions cost nothing. Only a 2xx whose body the caller accepts (extraction succeeded, output parsed) is
 * cached. After a 429 (one bounded retry first) the API cools down and a stale cached answer is served when
 * one exists.
 */
import type { Trace } from '../adapters/llm/trace';
import { resetBreakers } from '../external/breaker';
import {
	createExternalCall,
	RateLimited,
	resetExternalCache,
	type CacheStore
} from '../external/call';
import type { SpendGuard } from './spend';

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
	/** Shared response cache (Postgres `web_cache`) behind memory. */
	store?: CacheStore;
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

interface Stored {
	status: number;
	body: unknown;
	cost?: WebResponse<unknown>['cost'];
}

/** Test hook: forget cached answers and cool-downs. */
export function resetWebHttp() {
	resetExternalCache();
	resetBreakers();
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
	const external = createExternalCall({
		api: o.api === 'exa' ? 'exa' : 'contextdev',
		name: o.api,
		cacheDir: o.cacheDir,
		store: o.store,
		guard: o.guard,
		trace: o.trace,
		// A 4xx is our request's fault, not an outage.
		isOutage: (e) => !(e instanceof WebError) || e.status >= 500
	});

	return async function call<T>(
		path: string,
		body?: unknown,
		c: CallOptions = {}
	): Promise<WebResponse<T>> {
		const method = c.method ?? (body === undefined ? 'GET' : 'POST');
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (o.api === 'exa') headers['x-api-key'] = o.apiKey;
		else headers.authorization = `Bearer ${o.apiKey}`;

		const r = await external<Stored>(
			{
				key: `${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`,
				purpose: c.purpose ?? path,
				maxAgeMs: c.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
				accept: c.accept ? (s) => c.accept!(s.body) : undefined,
				detail: { path }
			},
			async () => {
				let res: Response;
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
						await new Promise((done) => setTimeout(done, wait));
						continue;
					}
					break;
				}
				const text = await res.text();
				let parsed: unknown;
				try {
					parsed = text ? JSON.parse(text) : null;
				} catch {
					parsed = { message: text.slice(0, 300) };
				}
				if (res.status === 429)
					throw new RateLimited(retryAfterS(res, DEFAULT_COOL_S), `${o.api} 429`);
				if (!res.ok) throw new WebError(o.api, res.status, parsed);
				const credits = Number(res.headers.get('x-credits-used') ?? NaN);
				const usd = (parsed as { costDollars?: { total?: number } })?.costDollars?.total;
				const cost = {
					...(Number.isFinite(credits) ? { credits } : {}),
					...(typeof usd === 'number' ? { usd } : {})
				};
				return {
					value: { status: res.status, body: parsed, cost },
					costUnits: Number.isFinite(credits) ? credits : undefined,
					detail: { status: res.status, ...cost }
				};
			}
		);
		return {
			ok: true,
			status: r.value.status,
			body: r.value.body as T,
			cached: r.cache === 'cache',
			latencyMs: r.latencyMs,
			at: r.at,
			cost: r.value.cost,
			...(r.stale ? { stale: true } : {})
		};
	};
}

function retryAfterS(res: Response, fallback: number): number {
	const n = Number(res.headers.get('retry-after'));
	return Number.isFinite(n) && n > 0 ? Math.ceil(n) : fallback;
}

export type WebCall = ReturnType<typeof createWebHttp>;
