import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { errMsg, log } from '$lib/server/obs/log';
import { readAccess } from '$lib/server/obs/read';
import { flushTraces, traceStore, traceWriterStatus } from '$lib/server/obs/traces';
import type { RequestHandler } from './$types';

/**
 * Per source (gemini, valio, exa, tool, …) over the window (default the last hour): count, p50/p95 latency, error
 * rate and cache-hit rate. Same filters and scoping as /api/ops/traces.
 * - `GET /api/ops/traces/summary?ws=ws-demo&since=1h` → `{ sources: SourceSummary[], filter, writer }`
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
	if (!store) return json({ sources: [], filter: access.filter, writer: traceWriterStatus() });
	await flushTraces();
	try {
		const sources = await store.summary(access.filter);
		return json({ sources, filter: access.filter, writer: traceWriterStatus() });
	} catch (e) {
		log.warn('trace.read_failed', { error: errMsg(e) });
		return json({
			sources: [],
			filter: access.filter,
			writer: traceWriterStatus(),
			persisted: false
		});
	}
};
