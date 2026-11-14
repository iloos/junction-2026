/**
 * One HTTP call to Context.dev or Exa: cached, traced, bounded. Both providers charge for cached
 * results on their side too, so every successful response is kept here (memory, plus a directory when
 * configured) and repeated questions cost nothing.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logTrace, noTrace, type Trace } from '../adapters/llm/trace';

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
}

export interface CallOptions {
	/** Reuse a cached response younger than this; 0 = always call. Default: forever. */
	maxAgeMs?: number;
	method?: 'GET' | 'POST';
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
}

interface Entry {
	at: string;
	status: number;
	body: unknown;
	cost?: WebResponse<unknown>['cost'];
}

const mem = new Map<string, Entry>();

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
	if (o.cacheDir) mkdirSync(o.cacheDir, { recursive: true });

	const keyOf = (method: string, path: string, body: unknown) =>
		createHash('sha256')
			.update(`${o.api} ${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`)
			.digest('hex')
			.slice(0, 32);

	function readCache(key: string): Entry | undefined {
		const hit = mem.get(key);
		if (hit || !o.cacheDir) return hit;
		const f = join(o.cacheDir, `${key}.json`);
		if (!existsSync(f)) return undefined;
		try {
			const e = JSON.parse(readFileSync(f, 'utf8')) as Entry;
			mem.set(key, e);
			return e;
		} catch {
			return undefined;
		}
	}

	function writeCache(key: string, e: Entry) {
		mem.set(key, e);
		if (o.cacheDir) writeFileSync(join(o.cacheDir, `${key}.json`), JSON.stringify(e));
	}

	return async function call<T>(
		path: string,
		body?: unknown,
		c: CallOptions = {}
	): Promise<WebResponse<T>> {
		const method = c.method ?? (body === undefined ? 'GET' : 'POST');
		const key = keyOf(method, path, body);
		const maxAge = c.maxAgeMs ?? Infinity;
		const hit = maxAge > 0 ? readCache(key) : undefined;
		if (hit && Date.now() - Date.parse(hit.at) <= maxAge) {
			const data = { source: o.api, model: path, purpose: c.purpose, cache: 'hit', latencyMs: 0 };
			trace('tool', data);
			logTrace(data);
			return {
				ok: true,
				status: hit.status,
				body: hit.body as T,
				cached: true,
				latencyMs: 0,
				at: hit.at,
				cost: hit.cost
			};
		}

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
				const wait = Math.min(Number(res.headers.get('retry-after') ?? 2) * 1000, 8000);
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
		if (!res.ok) throw new WebError(o.api, res.status, parsed);
		writeCache(key, { at, status: res.status, body: parsed, cost });
		return { ok: true, status: res.status, body: parsed as T, cached: false, latencyMs, at, cost };
	};
}

export type WebCall = ReturnType<typeof createWebHttp>;
