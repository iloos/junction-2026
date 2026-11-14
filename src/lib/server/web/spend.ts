/**
 * Daily call caps for the paid web APIs, per caller key and per instance, counted per UTC day. Only
 * real network calls count (cache hits are free). A cap reached is a `WebLimitError` with the seconds
 * until the next UTC midnight, which the routes answer as 429 with `Retry-After`.
 *
 * Env (calls per UTC day, per API):
 * - `WEB_CAP_PER_KEY` (default 40): one caller key (`<actor kind>:<key label>`)
 * - `WEB_CAP_GLOBAL` (default 600): everything this instance sends, the monitor included
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WebApi } from './http';

export interface SpendLimits {
	perKey: number;
	global: number;
}

/**
 * Defaults sized for the 10-minute monitor (144 runs a day are Context.dev's, not ours; our side is at
 * most a list read an hour plus a few notice reads per change) plus judges' lookups.
 */
export const DEFAULT_LIMITS: SpendLimits = { perKey: 40, global: 600 };

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
	let state: Day = { day: utcDay(clock()), counts: {} };
	if (file && existsSync(file)) {
		try {
			state = JSON.parse(readFileSync(file, 'utf8')) as Day;
		} catch {
			// A corrupt ledger starts the day at zero.
		}
	}
	const roll = () => {
		const d = utcDay(clock());
		if (state.day !== d) state = { day: d, counts: {} };
	};
	const flush = () => {
		if (!file) return;
		try {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, JSON.stringify(state));
		} catch {
			// Counting in memory is enough to protect this instance.
		}
	};
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
