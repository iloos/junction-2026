/**
 * Daily call caps for the paid web APIs, per caller key and per instance, counted per UTC day, on the shared
 * ledger (`external/ledger.ts`). Only real network calls count (cache hits are free). A cap reached is a
 * `WebLimitError` with the seconds until the next UTC midnight, which the routes answer as 429 with `Retry-After`.
 *
 * Env (calls per UTC day, per API):
 * - `WEB_CAP_PER_KEY` (default 40): one caller key (`<actor kind>:<key label>`)
 * - `WEB_CAP_GLOBAL` (default 1000): everything this instance sends, the monitor included
 */
import { err, type DomainError } from '$lib/core/contracts';
import {
	capFromEnv,
	createSpendLedger,
	LimitError,
	type SpendGuard,
	type SpendLedger,
	type SpendLimits
} from '../external/ledger';

export { createSpendLedger, type SpendGuard, type SpendLedger, type SpendLimits };
/** A call the web layer refused to send: a daily cap, or the provider's rate limit still cooling. */
export { LimitError as WebLimitError };

/**
 * Defaults sized for the 5-minute monitor (288 runs a day, run by Context.dev, not counted here) plus
 * judges. Our own calls per change are one fresh list read and at most 3 notice reads; `run.completed`
 * reads the list at most hourly. Even a monitor that flags a change on every run (~300 list reads a day)
 * leaves room for judges under the global cap, and a cap only refuses that API until UTC midnight.
 */
export const DEFAULT_LIMITS: SpendLimits = { perKey: 40, global: 1000 };

export function spendLimits(env: Record<string, string | undefined>): SpendLimits {
	return {
		perKey: capFromEnv(env.WEB_CAP_PER_KEY, DEFAULT_LIMITS.perKey),
		global: capFromEnv(env.WEB_CAP_GLOBAL, DEFAULT_LIMITS.global)
	};
}

/**
 * A web failure as a domain error: a cap or rate limit is PROVIDER_UNAVAILABLE with sub `rate_limit` |
 * `daily_cap` and `detail.retryAfter` (seconds), which every surface answers as 429; an unknown product
 * is NOT_FOUND; anything else from a provider is PROVIDER_UNAVAILABLE (retryable).
 */
export function webError(e: unknown): { ok: false; error: DomainError } {
	if (e instanceof LimitError)
		return err('PROVIDER_UNAVAILABLE', e.message, {
			sub: e.reason === 'rate-limit' ? 'rate_limit' : 'daily_cap',
			detail: { api: e.api, retryAfter: e.retryAfterS }
		});
	const msg = e instanceof Error ? e.message : String(e);
	if (/^unknown product/.test(msg)) return err('NOT_FOUND', msg);
	return err('PROVIDER_UNAVAILABLE', msg);
}
