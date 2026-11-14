/**
 * Daily call caps for the paid web APIs, per caller key and per instance, counted per UTC day. Only
 * real network calls count (cache hits are free). A cap reached is a `WebLimitError` with the seconds
 * until the next UTC midnight, which the routes answer as 429 with `Retry-After`.
 *
 * Env (calls per UTC day, per API):
 * - `WEB_CAP_PER_KEY` (default 40): one caller key (`<actor kind>:<key label>`)
 * - `WEB_CAP_GLOBAL` (default 1000): everything this instance sends, the monitor included
 */
import { readJson, writeJson } from './persist';
import { err, type DomainError } from '$lib/core/contracts';
import type { WebApi } from './http';

export interface SpendLimits {
	perKey: number;
	global: number;
}

/**
 * Defaults sized for the 5-minute monitor (288 runs a day, run by Context.dev, not counted here) plus
 * judges. Our own calls per change are one fresh list read and at most 3 notice reads; `run.completed`
 * reads the list at most hourly. Even a monitor that flags a change on every run (~300 list reads a day)
 * leaves room for judges under the global cap, and a cap only refuses that API until UTC midnight.
 */
export const DEFAULT_LIMITS: SpendLimits = { perKey: 40, global: 1000 };

export function spendLimits(env: Record<string, string | undefined>): SpendLimits {
	const n = (v: string | undefined, d: number) => {
		const x = Number(v);
		return v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : d;
	};
	return {
		perKey: n(env.WEB_CAP_PER_KEY, DEFAULT_LIMITS.perKey),
		global: n(env.WEB_CAP_GLOBAL, DEFAULT_LIMITS.global)
	};
}

/** A call the web layer refused to send: a daily cap, or the provider's rate limit still cooling. */
export class WebLimitError extends Error {
	constructor(
		readonly reason: 'cap-key' | 'cap-global' | 'rate-limit',
		readonly api: WebApi,
		readonly retryAfterS: number
	) {
		super(
			reason === 'rate-limit'
				? `${api} is rate-limited; try again in ${retryAfterS} s`
				: `${api} daily ${reason === 'cap-key' ? 'per-key' : 'global'} cap reached; resets in ${Math.ceil(retryAfterS / 60)} min`
		);
	}
}

/**
 * A web failure as a domain error: a cap or rate limit is PROVIDER_UNAVAILABLE with sub `rate_limit` |
 * `daily_cap` and `detail.retryAfter` (seconds), which every surface answers as 429; an unknown product
 * is NOT_FOUND; anything else from a provider is PROVIDER_UNAVAILABLE (retryable).
 */
export function webError(e: unknown): { ok: false; error: DomainError } {
	if (e instanceof WebLimitError)
		return err('PROVIDER_UNAVAILABLE', e.message, {
			sub: e.reason === 'rate-limit' ? 'rate_limit' : 'daily_cap',
			detail: { api: e.api, retryAfter: e.retryAfterS }
		});
	const msg = e instanceof Error ? e.message : String(e);
	if (/^unknown product/.test(msg)) return err('NOT_FOUND', msg);
	return err('PROVIDER_UNAVAILABLE', msg);
}

/** Called before every network call; throws `WebLimitError` instead of spending. */
export interface SpendGuard {
	charge(api: WebApi): void;
}

interface Day {
	day: string;
	counts: Partial<Record<WebApi, { global: number; keys: Record<string, number> }>>;
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const toMidnightS = (now: Date) => {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};

export function createSpendLedger(file?: string, clock: () => Date = () => new Date()) {
	// A lost ledger starts the day at zero.
	let state = readJson<Day>(file, { day: utcDay(clock()), counts: {} });
	const roll = () => {
		const d = utcDay(clock());
		if (state.day !== d) state = { day: d, counts: {} };
	};
	const flush = () => writeJson(file, state);
	return {
		/** A guard for one caller; `key` null = an internal caller (the monitor), bound by the global cap only. */
		guard(key: string | null, limits: SpendLimits): SpendGuard {
			return {
				charge(api) {
					roll();
					const c = (state.counts[api] ??= { global: 0, keys: {} });
					const now = clock();
					if (c.global >= limits.global)
						throw new WebLimitError('cap-global', api, toMidnightS(now));
					if (key !== null && (c.keys[key] ?? 0) >= limits.perKey)
						throw new WebLimitError('cap-key', api, toMidnightS(now));
					c.global++;
					if (key !== null) c.keys[key] = (c.keys[key] ?? 0) + 1;
					flush();
				}
			};
		},
		usage(): Day {
			roll();
			return structuredClone(state);
		}
	};
}

export type SpendLedger = ReturnType<typeof createSpendLedger>;
