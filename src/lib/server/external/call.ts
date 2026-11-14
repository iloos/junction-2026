/**
 * One call to an outside service (Exa, Context.dev, Gemini, Valio), with the same plumbing for each:
 * a response cache (memory, plus a directory when configured), a spend guard charged before every network
 * call (never for a cache hit), a half-open circuit breaker, and one `ExternalCallTrace` per call so the
 * trace drawer and an Ops cost view read one shape. `cache` in the result and the trace says honestly
 * where the answer came from: `live` (sent now) or `cache` (stored earlier; `stale` when served past its
 * age because the provider is refusing).
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ExternalCallTrace } from '$lib/core/contracts/task';
import { logTrace, noTrace, type Trace, type TraceStep } from '../adapters/llm/trace';
import { breakerFor, type Breaker } from './breaker';
import { LimitError, type SpendGuard } from './ledger';
import { readJson, writeJson } from './persist';
import { currentScope, type ExternalScope } from './scope';
import { withinOuterTrace } from '../obs/context';
import { errMsg, log } from '../obs/log';

export type ExternalApi = ExternalCallTrace['api'];

/** Thrown by a sender when the provider rate-limits (HTTP 429): opens the breaker for `retryAfterS`. */
export class RateLimited extends Error {
	constructor(
		readonly retryAfterS: number,
		message = 'rate limited'
	) {
		super(message);
	}
}

export interface ExternalCallOptions {
	api: ExternalApi;
	/** Breaker and cache namespace, e.g. 'context.dev'. Default: `api`. */
	name?: string;
	/** false = never store answers (the caller keeps its own record, e.g. the Decide replay book). */
	cache?: boolean;
	/** Directory for the response cache; memory only when absent and no `store`. */
	cacheDir?: string;
	/** Shared cache read on a memory miss and written on every accepted answer. */
	store?: CacheStore;
	/** Charged before every network call; a function picks the guard for the caller's scope. */
	guard?: SpendGuard | ((scope: ExternalScope | undefined) => SpendGuard | undefined);
	/** Where traces go. Default: the caller's scope (`withExternalScope`), else nowhere. */
	trace?: Trace;
	step?: TraceStep;
	breaker?: Breaker;
	/** Whether a thrown error counts towards opening the breaker (a 400 does not). Default: yes. */
	isOutage?: (e: unknown) => boolean;
}

export interface CallRequest<T> {
	/** Cache key material; hashed with the name. */
	key: unknown;
	purpose: string;
	/** Reuse a cached answer younger than this; 0 (default) = always send; a stored answer then serves only while the provider refuses. */
	maxAgeMs?: number;
	/** Cache the answer only when this holds (e.g. the extraction succeeded). Default: always. */
	accept?: (v: T) => boolean;
	/** An accepted answer that should not stand for the day (nothing found): reused for `SHORT_LIVED_MS` only. */
	shortLived?: (v: T) => boolean;
	/** Extra trace fields (status, path, question count). */
	detail?: Record<string, unknown>;
}

export interface Sent<T> {
	value: T;
	/** Provider units: tokens, credits, ids requested. */
	costUnits?: number;
	model?: string;
	/** Extra trace fields known after the call (HTTP status, dollars). */
	detail?: Record<string, unknown>;
}

export interface CallResult<T> {
	value: T;
	cache: 'live' | 'cache';
	stale: boolean;
	latencyMs: number;
	/** When the answer was produced (ISO). */
	at: string;
	costUnits?: number;
}

export interface CacheEntry {
	at: string;
	value: unknown;
	costUnits?: number;
	/** A shorter life than the caller's max age (an empty answer); kept in memory only. */
	maxAgeMs?: number;
}

/** How long an empty or unhelpful answer is reused before the next read asks again. */
export const SHORT_LIVED_MS = 5 * 60_000;
type Entry = CacheEntry;

/** A shared response cache behind memory (Postgres `web_cache`): survives a redeploy, shared by instances. */
export interface CacheStore {
	get(key: string): Promise<CacheEntry | undefined>;
	put(key: string, api: string, e: CacheEntry): Promise<void>;
}

const mem = new Map<string, Entry>();
/** Test hook: forget every cached answer. */
export function resetExternalCache() {
	mem.clear();
}

export function externalKey(name: string, key: unknown): string {
	return createHash('sha256')
		.update(`${name} ${typeof key === 'string' ? key : JSON.stringify(key ?? null)}`)
		.digest('hex')
		.slice(0, 32);
}

/** Emits one `ExternalCallTrace` (plus the caller's detail) and the dev console line. */
export function reportExternal(
	trace: Trace,
	step: TraceStep,
	t: ExternalCallTrace,
	detail: Record<string, unknown> = {}
) {
	const data = { ...detail, ...t, source: t.api };
	trace(t.ok ? step : 'error', data);
	logTrace(data, t.ok ? step : 'error');
}

export function createExternalCall(o: ExternalCallOptions) {
	const name = o.name ?? o.api;
	const breaker = o.breaker ?? breakerFor(name);
	const step = o.step ?? 'tool';

	async function readCache(k: string): Promise<Entry | undefined> {
		const hit = mem.get(k);
		if (hit) return hit;
		let e: Entry | undefined;
		if (o.store) e = await o.store.get(k).catch(() => undefined);
		if (!e && o.cacheDir) e = readJson<Entry | undefined>(join(o.cacheDir, `${k}.json`), undefined);
		if (e) mem.set(k, e);
		return e;
	}
	function writeCache(k: string, e: Entry) {
		mem.set(k, e);
		if (o.cacheDir) writeJson(join(o.cacheDir, `${k}.json`), e);
		o.store
			?.put(k, name, e)
			.catch((err) => log.error('external.cache_write_failed', { api: name, error: errMsg(err) }));
	}

	return async function call<T>(
		req: CallRequest<T>,
		send: () => Promise<Sent<T>>
	): Promise<CallResult<T>> {
		const scope = currentScope();
		const trace = o.trace ?? scope?.trace ?? noTrace;
		const base = { api: o.api, purpose: req.purpose.slice(0, 80), workspaceId: scope?.workspaceId };
		const k = externalKey(name, req.key);
		const maxAge = req.maxAgeMs ?? 0;
		const entry = o.cache === false ? undefined : await readCache(k);

		const fromCache = (e: Entry, stale: boolean): CallResult<T> => {
			reportExternal(
				trace,
				step,
				{ ...base, cache: 'cache', ok: true, latencyMs: 0 },
				{ ...req.detail, stale, at: e.at }
			);
			return { value: e.value as T, cache: 'cache', stale, latencyMs: 0, at: e.at };
		};
		if (
			maxAge > 0 &&
			entry &&
			Date.now() - Date.parse(entry.at) <= Math.min(maxAge, entry.maxAgeMs ?? maxAge)
		)
			return fromCache(entry, false);

		const wait = breaker.acquire();
		if (wait !== null) {
			if (entry) return fromCache(entry, true);
			reportExternal(
				trace,
				step,
				{ ...base, cache: 'live', ok: false, latencyMs: 0, error: `breaker open ${wait}s` },
				req.detail
			);
			throw new LimitError('rate-limit', name, wait);
		}
		try {
			await (typeof o.guard === 'function' ? o.guard(scope) : o.guard)?.charge(name);
		} catch (e) {
			breaker.success(); // nothing was sent: release a half-open probe slot
			throw e;
		}

		const t0 = performance.now();
		try {
			const r = await withinOuterTrace(send);
			const latencyMs = Math.round(performance.now() - t0);
			breaker.success();
			const at = new Date().toISOString();
			reportExternal(
				trace,
				step,
				{ ...base, cache: 'live', ok: true, latencyMs, costUnits: r.costUnits, model: r.model },
				{ ...req.detail, ...r.detail }
			);
			if ((!req.accept || req.accept(r.value)) && o.cache !== false) {
				if (req.shortLived?.(r.value))
					mem.set(k, { at, value: r.value, costUnits: r.costUnits, maxAgeMs: SHORT_LIVED_MS });
				else writeCache(k, { at, value: r.value, costUnits: r.costUnits });
			}
			return { value: r.value, cache: 'live', stale: false, latencyMs, at, costUnits: r.costUnits };
		} catch (e) {
			const latencyMs = Math.round(performance.now() - t0);
			const msg = String((e as Error)?.message ?? e).slice(0, 300);
			reportExternal(
				trace,
				step,
				{ ...base, cache: 'live', ok: false, latencyMs, error: msg },
				req.detail
			);
			if (e instanceof RateLimited) {
				breaker.trip(e.retryAfterS);
				if (entry) return fromCache(entry, true);
				throw new LimitError('rate-limit', name, e.retryAfterS);
			}
			if (o.isOutage?.(e) ?? true) breaker.failure();
			else breaker.success();
			throw e;
		}
	};
}

export type ExternalCall = ReturnType<typeof createExternalCall>;
