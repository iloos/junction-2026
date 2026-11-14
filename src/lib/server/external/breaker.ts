/**
 * Circuit breaker per outside API. Closed: calls go. After `failures` failures in a row, or a 429 with its
 * Retry-After, it opens for a cool-down. When the cool-down ends it is half-open: one probe call goes; a
 * success closes it, a failure opens it again. Process-wide per name, like the provider's own limit.
 */
export interface BreakerOptions {
	/** Consecutive failures that open the breaker. */
	failures?: number;
	/** Cool-down after failures, in seconds. A 429 uses its own Retry-After. */
	coolS?: number;
	now?: () => number;
}

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface Breaker {
	/** null = the call may go (in half-open, this caller is the probe); else seconds to wait. */
	acquire(): number | null;
	success(): void;
	failure(): void;
	/** Open for `seconds` now (a 429 with Retry-After). */
	trip(seconds: number): void;
	state(): BreakerState;
	reset(): void;
}

export function createBreaker(o: BreakerOptions = {}): Breaker {
	const max = o.failures ?? 5;
	const coolS = o.coolS ?? 60;
	const now = o.now ?? Date.now;
	let fails = 0;
	let openUntil = 0;
	let probing = false;
	const state = (): BreakerState =>
		openUntil === 0 ? 'closed' : now() < openUntil ? 'open' : 'half-open';
	return {
		acquire() {
			const s = state();
			if (s === 'closed') return null;
			if (s === 'open') return Math.max(1, Math.ceil((openUntil - now()) / 1000));
			if (probing) return 1;
			probing = true;
			return null;
		},
		success() {
			fails = 0;
			openUntil = 0;
			probing = false;
		},
		failure() {
			fails++;
			if (probing || fails >= max) openUntil = now() + coolS * 1000;
			probing = false;
		},
		trip(seconds) {
			openUntil = now() + seconds * 1000;
			probing = false;
		},
		state,
		reset() {
			fails = 0;
			openUntil = 0;
			probing = false;
		}
	};
}

const registry = new Map<string, Breaker>();
/** The process-wide breaker for one API name. */
export function breakerFor(name: string, o?: BreakerOptions): Breaker {
	let b = registry.get(name);
	if (!b) registry.set(name, (b = createBreaker(o)));
	return b;
}
/** Every shared breaker's state, by name (for the service status). */
export function breakerStates(): Record<string, BreakerState> {
	return Object.fromEntries([...registry].map(([name, b]) => [name, b.state()]));
}
export function resetBreakers() {
	registry.clear();
}
