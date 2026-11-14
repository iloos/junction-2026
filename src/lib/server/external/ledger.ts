/**
 * Daily spend caps for paid outside APIs, per caller key and per instance, counted per UTC day. Only real
 * network calls are charged (cache hits and replays are free). A cap reached is a `LimitError` carrying the
 * seconds until the next UTC midnight, which routes answer as 429 with `Retry-After`. The state is one small
 * JSON file; a lost file starts the day at zero.
 */
import { readJson, writeJson } from './persist';

export interface SpendLimits {
	perKey: number;
	global: number;
}

/** A call refused before it was sent: a daily cap, or the provider's rate limit still cooling. */
export class LimitError extends Error {
	constructor(
		readonly reason: 'cap-key' | 'cap-global' | 'rate-limit',
		readonly api: string,
		readonly retryAfterS: number
	) {
		super(
			reason === 'rate-limit'
				? `${api} is rate-limited; try again in ${retryAfterS} s`
				: `${api} daily ${reason === 'cap-key' ? 'per-key' : 'global'} cap reached; resets in ${Math.ceil(retryAfterS / 60)} min`
		);
	}
}

/** Called before every network call; throws `LimitError` instead of spending. */
export interface SpendGuard {
	/** Throws (or rejects with) `LimitError` at a cap; the Postgres ledger is async. */
	charge(api: string): void | Promise<void>;
}

export interface Day {
	day: string;
	counts: Record<string, { global: number; keys: Record<string, number> } | undefined>;
}

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const toMidnightS = (now: Date) => {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};

/** Reads a non-negative integer from the env, or the default. */
export function capFromEnv(v: string | undefined, d: number): number {
	const x = Number(v);
	return v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : d;
}

export function createSpendLedger(file?: string, clock: () => Date = () => new Date()) {
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
					if (c.global >= limits.global) throw new LimitError('cap-global', api, toMidnightS(now));
					if (key !== null && (c.keys[key] ?? 0) >= limits.perKey)
						throw new LimitError('cap-key', api, toMidnightS(now));
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

/** Anything that hands out guards: the file ledger above or the Postgres one (web/pg-state.ts). */
export interface GuardSource {
	guard(key: string | null, limits: SpendLimits): SpendGuard;
}

const shared = globalThis as typeof globalThis & { __sharedLedger?: GuardSource | null };
/** The instance-shared ledger (Postgres `web_spend`) once the web state is attached; null before. */
export const sharedLedger = (): GuardSource | null => shared.__sharedLedger ?? null;
export function setSharedLedger(l: GuardSource | null) {
	shared.__sharedLedger = l;
}
