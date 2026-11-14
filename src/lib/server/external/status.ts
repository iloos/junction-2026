/**
 * Service status: what each outside service is doing right now, read from the calls it actually served (every
 * ExternalCallTrace passes `noteExternal` through `logTrace`) and from the breakers. Nothing here is configured or
 * guessed: a service that hasn't been called says so. Process-local, like the breakers (`mandate` runs one
 * instance). Read by /healthz and the Ops header.
 */
import type { ExternalCallTrace } from '$lib/core/contracts/task';
import { breakerStates, type BreakerState } from './breaker';

export type Service = 'valio' | 'gemini' | 'exa' | 'contextdev';
export const SERVICES: Service[] = ['valio', 'gemini', 'exa', 'contextdev'];

/** Where answers came from: sent now, a stored answer, Decide's recorded book, Decide's rules, or a fixture. */
export type Source = 'live' | 'cache' | 'replay' | 'rules' | 'fixture';

export interface ServiceStatus {
	service: Service;
	/**
	 * `live`/`cache`/`replay`/`rules`/`fixture`: where its latest answer came from. `breaker_open`: calls are
	 * refused until the cool-down ends. `failing`: its latest live call failed. `idle`: not called since start.
	 */
	mode: Source | 'breaker_open' | 'failing' | 'idle';
	breaker: BreakerState | null;
	/** The latest call (any source). */
	last: { at: string; source: Source; ok: boolean; latencyMs: number; error?: string } | null;
	/** The latest call actually sent to the provider, and how long ago (s). */
	lastLive: { at: string; ok: boolean; ageS: number } | null;
	/** Calls in the last WINDOW_MS, by source; `failed` counts live calls that failed. */
	recent: Partial<Record<Source | 'failed', number>>;
}

const WINDOW_MS = 15 * 60_000;
const KEEP = 500;

type Seen = { t: number; source: Source; ok: boolean; latencyMs: number; error?: string };

const g = globalThis as typeof globalThis & {
	__mandateServiceCalls?: Map<Service, Seen[]>;
	__mandateBreakerProbes?: Map<Service, () => BreakerState | 'half_open'>;
};
const calls: Map<Service, Seen[]> = (g.__mandateServiceCalls ??= new Map());
const probes: Map<Service, () => BreakerState | 'half_open'> = (g.__mandateBreakerProbes ??=
	new Map());

const isService = (api: unknown): api is Service =>
	typeof api === 'string' && (SERVICES as string[]).includes(api);

/** Decide labels its rules fallback `fixture` with source `rules`; everything else says where it came from. */
function sourceOf(data: Record<string, unknown>): Source | null {
	const cache = data.cache;
	if (data.source === 'rules' || data.model === 'rules') return 'rules';
	if (cache === 'live' || cache === 'cache' || cache === 'replay' || cache === 'fixture')
		return cache;
	return null;
}

/** Record one outside call (a logged ExternalCallTrace, with Decide's `source`). Ignores anything else. */
export function noteExternal(
	data: Partial<ExternalCallTrace> & Record<string, unknown>,
	now = Date.now()
) {
	if (!isService(data.api)) return;
	const source = sourceOf(data);
	if (!source) return;
	const list = calls.get(data.api) ?? [];
	list.push({
		t: now,
		source,
		ok: data.ok !== false,
		latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : 0,
		...(typeof data.error === 'string' ? { error: data.error.slice(0, 160) } : {})
	});
	if (list.length > KEEP) list.splice(0, list.length - KEEP);
	calls.set(data.api, list);
}

/** A breaker that lives outside the shared registry (Valio's live adapter keeps its own). */
export function registerBreaker(service: Service, state: () => BreakerState | 'half_open') {
	probes.set(service, state);
}

/** Whether a service's own breaker was registered: for Valio, whether the live adapter was built at all. */
export const hasOwnBreaker = (service: Service) => probes.has(service);

function breakerOf(service: Service): BreakerState | null {
	const own = probes.get(service)?.();
	if (own) return own === 'half_open' ? 'half-open' : own;
	// Shared breakers are named by API, sometimes with a suffix ('context.dev', 'gemini-text').
	const all = breakerStates();
	const mine = Object.entries(all).filter(
		([name]) => name.replace(/[^a-z]/g, '').startsWith(service) || name === service
	);
	if (!mine.length) return null;
	if (mine.some(([, s]) => s === 'open')) return 'open';
	if (mine.some(([, s]) => s === 'half-open')) return 'half-open';
	return 'closed';
}

export function serviceStatus(service: Service, now = Date.now()): ServiceStatus {
	const list = calls.get(service) ?? [];
	const last = list.at(-1);
	const live = list.findLast((c) => c.source === 'live');
	const recent: ServiceStatus['recent'] = {};
	for (const c of list) {
		if (now - c.t > WINDOW_MS) continue;
		const k = c.source === 'live' && !c.ok ? 'failed' : c.source;
		recent[k] = (recent[k] ?? 0) + 1;
	}
	const breaker = breakerOf(service);
	const mode: ServiceStatus['mode'] =
		breaker === 'open'
			? 'breaker_open'
			: !last
				? 'idle'
				: last.source === 'live' && !last.ok
					? 'failing'
					: last.source;
	return {
		service,
		mode,
		breaker,
		last: last
			? {
					at: new Date(last.t).toISOString(),
					source: last.source,
					ok: last.ok,
					latencyMs: last.latencyMs,
					...(last.error ? { error: last.error } : {})
				}
			: null,
		lastLive: live
			? {
					at: new Date(live.t).toISOString(),
					ok: live.ok,
					ageS: Math.round((now - live.t) / 1000)
				}
			: null,
		recent
	};
}

export const servicesStatus = (now = Date.now()) => SERVICES.map((s) => serviceStatus(s, now));

/** Test hook. */
export function resetServiceStatus() {
	calls.clear();
	probes.clear();
}
