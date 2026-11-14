/**
 * Valio's price and availability API, called on a cache miss (cache-through, docs/foundations/valio-data.md §4–5):
 * at most 200 ids per call, 4 calls at once, retried with backoff on 429/403/5xx, each call bounded by a timeout.
 * A breaker opens after 3 consecutive failures and half-opens after a cool-down: one trial call, which closes it on
 * success or reopens it. Every call is reported as an ExternalCallTrace. Callers store what comes back; this module
 * holds no cache of its own.
 */
import type { ExternalCallTrace } from '$lib/core/contracts';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Valio JSON */
type Raw = any;

export type ValioEndpoint = 'price' | 'availability';

export interface ValioLiveOptions {
	apiKey: string;
	baseUrl?: string;
	customer?: string;
	fetch?: typeof fetch;
	/** Called once per HTTP attempt (live) with what it cost and how it ended. */
	onCall?: (t: ExternalCallTrace) => void;
	/** Consecutive failures that open the breaker (default 3). */
	failuresToOpen?: number;
	/** How long the breaker stays open before a trial call (default 60 s). */
	coolDownMs?: number;
	/** Per-attempt timeout (default 10 s). */
	timeoutMs?: number;
	/** Retries per batch after the first attempt (default 2); backoff base in ms (default 2000). */
	retries?: number;
	backoffMs?: number;
	/** HTTP calls in flight at once for this adapter, across endpoints and callers (default 4). */
	concurrency?: number;
	now?: () => number;
}

export interface ValioEntry {
	productId: string;
	body: Raw;
	/** When Valio answered, ISO 8601. */
	at: string;
}

export type BreakerState = 'closed' | 'open' | 'half_open';

const chunk = <T>(xs: T[], n: number) =>
	Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** At most `limit` holders at once, across every caller that shares it; waiters go first in, first out. */
function semaphore(limit: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async function run<R>(fn: () => Promise<R>): Promise<R> {
		if (active >= limit) await new Promise<void>((r) => waiting.push(r));
		else active++;
		try {
			return await fn();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

export function createValioLive(o: ValioLiveOptions) {
	const base = o.baseUrl ?? 'https://junction26.valioaimo.fi';
	const customer = o.customer ?? '123';
	const doFetch = o.fetch ?? fetch;
	const now = o.now ?? Date.now;
	const toOpen = o.failuresToOpen ?? 3;
	const coolDown = o.coolDownMs ?? 60_000;
	const retries = o.retries ?? 2;
	const backoff = o.backoffMs ?? 2000;
	const slot = semaphore(o.concurrency ?? 4);
	/** Identical batches already on the wire: a second caller waits for the same answer. */
	const inFlight = new Map<string, Promise<ValioEntry[]>>();
	let failures = 0;
	let openedAt: number | null = null;
	let trial = false;

	function state(): BreakerState {
		if (openedAt === null) return 'closed';
		return now() - openedAt >= coolDown ? 'half_open' : 'open';
	}
	/** Whether a call may go out now; in half-open only one trial at a time. */
	function admit(): boolean {
		const s = state();
		if (s === 'closed') return true;
		if (s === 'open' || trial) return false;
		trial = true;
		return true;
	}
	function succeeded() {
		failures = 0;
		openedAt = null;
		trial = false;
	}
	function failed() {
		failures++;
		if (trial || failures >= toOpen) openedAt = now();
		trial = false;
	}

	async function batch(ep: ValioEndpoint, ids: string[], date: string): Promise<ValioEntry[]> {
		for (let attempt = 0; attempt <= retries; attempt++) {
			if (!admit()) return [];
			const t0 = now();
			try {
				const res = await slot(() =>
					doFetch(`${base}/api/${ep}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json', 'X-API-Key': o.apiKey },
						body: JSON.stringify({ customer, requestedDate: date, products: ids }),
						// A hung call counts as a failure (retry, then the breaker), never a stuck request.
						signal: AbortSignal.timeout(o.timeoutMs ?? 10_000)
					}).then(async (r) => ({ r, body: r.ok ? await r.json() : null }))
				);
				const { body } = res;
				if (res.r.status === 429 || res.r.status === 403 || res.r.status >= 500)
					throw new Error(`HTTP ${res.r.status}`);
				const at = new Date(now()).toISOString();
				succeeded();
				o.onCall?.({
					api: 'valio',
					purpose: `offers.${ep}`,
					cache: 'live',
					ok: res.r.ok,
					latencyMs: now() - t0,
					costUnits: ids.length,
					...(res.r.ok ? {} : { error: `HTTP ${res.r.status}` })
				});
				return ((body?.products ?? []) as Raw[])
					.filter((e) => e?.productId !== undefined && e?.productId !== null)
					.map((e) => ({ productId: String(e.productId), body: e, at }));
			} catch (e) {
				failed();
				o.onCall?.({
					api: 'valio',
					purpose: `offers.${ep}`,
					cache: 'live',
					ok: false,
					latencyMs: now() - t0,
					costUnits: ids.length,
					error: String((e as Error)?.message ?? e).slice(0, 300)
				});
				if (attempt < retries)
					await new Promise((r) => setTimeout(r, backoff * 2 ** attempt * (0.5 + Math.random())));
			}
		}
		return [];
	}

	return {
		customer,
		breaker: state,
		/** Entries Valio returned for these ids (fewer when it failed or the breaker is open). */
		async fetch(ep: ValioEndpoint, ids: string[], date: string): Promise<ValioEntry[]> {
			const unique = [...new Set(ids)];
			if (unique.length === 0) return [];
			const parts = chunk(unique.sort(), 200).map((part) => {
				const key = `${ep}|${date}|${part.join(',')}`;
				let p = inFlight.get(key);
				if (!p) {
					p = batch(ep, part, date).finally(() => inFlight.delete(key));
					inFlight.set(key, p);
				}
				return p;
			});
			return (await Promise.all(parts)).flat();
		}
	};
}

export type ValioLive = ReturnType<typeof createValioLive>;
