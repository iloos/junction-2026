import { json } from '@sveltejs/kit';
import { dbHealth } from '$lib/server/db/client';
import type { RequestHandler } from './$types';

/** Liveness plus Postgres reachability. 503 only when a configured database is unreachable. */
export const GET: RequestHandler = async () => {
	const health = await dbHealth();
	return json(
		{ ok: health.db !== 'error', ...health, time: new Date().toISOString() },
		{ status: health.db === 'error' ? 503 : 200, headers: { 'cache-control': 'no-store' } }
	);
};
