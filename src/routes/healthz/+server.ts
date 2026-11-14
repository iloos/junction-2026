import { existsSync, readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dbHealth } from '$lib/server/db/client';
import { hasOwnBreaker, servicesStatus, type Service } from '$lib/server/external/status';
import { createServerPorts } from '$lib/server/store/server-ports';
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

/**
 * Liveness, Postgres reachability, the deployed commit and each outside service's state: where its latest answer
 * came from (live, cache, replay, rules), its breaker and the age of its last live call (external/status.ts).
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
	return json(
		{ ok: health.db !== 'error', ...health, commit, time: new Date().toISOString(), services },
		{ status: health.db === 'error' ? 503 : 200, headers: { 'cache-control': 'no-store' } }
	);
};
