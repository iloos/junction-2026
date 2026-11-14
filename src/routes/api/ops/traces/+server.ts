import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { errMsg, log } from '$lib/server/obs/log';
import { readAccess, toTraceEvent, toView } from '$lib/server/obs/read';
import { flushTraces, traceStore } from '$lib/server/obs/traces';
import type { RequestHandler } from './$types';

/**
 * Stored traces (7 days), newest first. Read-only, scoped like /api/events.
 * - `GET /api/ops/traces?ws=ws-demo&since=1h&source=gemini&requestId=req-…&limit=200`
 *   → `{ traces: TraceView[], filter }`
 * - `…&as=events` → `{ events }`: the same rows as `trace` ServerEvents, oldest first, for the trace drawer.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const access = readAccess(url, cookies, env, dev);
	if (!access.ok)
		return json(
			{
				error: {
					code: access.status === 403 ? 'FORBIDDEN' : 'INVALID_INPUT',
					message: access.message,
					retryable: false
				}
			},
			{ status: access.status }
		);
	const store = await traceStore();
	if (!store) return json({ traces: [], filter: access.filter, persisted: false });
	await flushTraces();
	let rows;
	try {
		rows = (await store.list(access.filter)).map(toView);
	} catch (e) {
		// Before `pnpm db:migrate` creates the table, or while the database is away: empty, and said so.
		log.warn('trace.read_failed', { error: errMsg(e) });
		return json({ traces: [], events: [], filter: access.filter, persisted: false });
	}
	if (url.searchParams.get('as') === 'events')
		return json({ events: rows.reverse().map(toTraceEvent), filter: access.filter });
	return json({ traces: rows, filter: access.filter, persisted: true });
};
