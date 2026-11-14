import { existsSync, readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dbHealth } from '$lib/server/db/client';
import type { RequestHandler } from './$types';

/** The deployed commit: COMMIT_SHA if the platform sets it, else the COMMIT file the image build stamps. */
const commit =
	env.COMMIT_SHA?.trim() ||
	(existsSync('COMMIT') ? readFileSync('COMMIT', 'utf8').trim() : '') ||
	'unknown';

/** Liveness, Postgres reachability and the deployed commit. 503 only when a configured database is unreachable. */
export const GET: RequestHandler = async () => {
	const health = await dbHealth();
	return json(
		{ ok: health.db !== 'error', ...health, commit, time: new Date().toISOString() },
		{ status: health.db === 'error' ? 503 : 200, headers: { 'cache-control': 'no-store' } }
	);
};
