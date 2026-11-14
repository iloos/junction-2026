import { existsSync, readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dbHealth } from '$lib/server/db/client';
import { hasOwnBreaker, servicesStatus, type Service } from '$lib/server/external/status';
import { createServerPorts } from '$lib/server/store/server-ports';
import { traceStore } from '$lib/server/obs/traces';
import type { RequestHandler } from './$types';

/** The deployed commit: COMMIT_SHA if the platform sets it, else the COMMIT file the image build stamps. */
const commit =
	env.COMMIT_SHA?.trim() ||
	(existsSync('COMMIT') ? readFileSync('COMMIT', 'utf8').trim() : '') ||
	'unknown';

const PORTS_WAIT_MS = 1500;

/** Whether a service may go live at all (its key is set and nothing forces the fixture). Presence only. */
function configured(s: Service): boolean {
	switch (s) {
		case 'valio':
			// Built only on a real database with a key (server-ports.ts); the in-memory fixture reads stored offers.
			return hasOwnBreaker('valio');
		case 'gemini':
			return env.LLM_PROVIDER !== 'fixture' && !!(env.GEMINI_API_KEY || env.GEMINI_STUDIO_API_KEY);
		case 'exa':
			return !!env.EXA_API_KEY;
		case 'contextdev':
			return !!env.CONTEXT_DEV_API_KEY;
	}
}

const DAY_MS = 24 * 3_600_000;
const DAY_CACHE_MS = 60_000;
type DayCounts = Record<
	string,
	{ calls: number; live: number; liveOk: number; cache: number; replay: number; fixture: number }
>;
let dayCache: { at: number; value: DayCounts | null } | null = null;

/**
 * Outside calls of the last 24 hours per source, from the stored traces (they survive a restart, unlike
 * `services`, which counts this process only). Counts only, every workspace together; read at most once a minute.
 * Null without a trace store (no database) or when it can't be read.
 */
async function lastDay(): Promise<DayCounts | null> {
	if (dayCache && Date.now() - dayCache.at < DAY_CACHE_MS) return dayCache.value;
	let value: DayCounts | null = null;
	try {
		const store = await traceStore();
		if (store) {
			const rows = await store.summary({ since: new Date(Date.now() - DAY_MS).toISOString() });
			value = Object.fromEntries(
				rows
					.filter((r) => r.source !== 'tool')
					.map((r) => [
						r.source,
						{
							calls: r.count,
							live: r.byMode.live,
							liveOk: r.liveOk,
							cache: r.byMode.cache,
							replay: r.byMode.replay,
							fixture: r.byMode.fixture
						}
					])
			);
		}
	} catch {
		value = null;
	}
	dayCache = { at: Date.now(), value };
	return value;
}

/**
 * Liveness, Postgres reachability, the deployed commit and each outside service's state: where its latest answer
 * came from (live, cache, replay, rules), its breaker and the age of its last live call (external/status.ts), and
 * `day`: each source's calls over the last 24 hours from the stored traces, which a restart does not reset.
 * 503 only when a configured database is unreachable; an outside service being down never fails liveness.
 */
export const GET: RequestHandler = async () => {
	const health = await dbHealth();
	// The ports are built once per process; building them registers the live Valio adapter if there is one.
	// Liveness never waits on it: at most PORTS_WAIT_MS, then the services report what they have.
	await Promise.race([
		createServerPorts().catch(() => undefined),
		new Promise((r) => setTimeout(r, PORTS_WAIT_MS))
	]);
	const services = servicesStatus().map((s) => ({ ...s, configured: configured(s.service) }));
	const day = await Promise.race([
		lastDay(),
		new Promise<null>((r) => setTimeout(() => r(null), PORTS_WAIT_MS))
	]);
	return json(
		{ ok: health.db !== 'error', ...health, commit, time: new Date().toISOString(), services, day },
		{ status: health.db === 'error' ? 503 : 200, headers: { 'cache-control': 'no-store' } }
	);
};
