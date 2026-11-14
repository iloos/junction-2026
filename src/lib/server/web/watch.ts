/**
 * What a monitor change does: re-read the recall list fresh, find notices this workspace hasn't seen,
 * extract each and ingest it. Also the presenter replay of a recorded real notice.
 */
import type { ServerEvent } from '$lib/core/contracts';
import { traceEvent, type Trace } from '../adapters/llm/trace';
import { publish } from '../bus';
import type { ChangeDetected, RecallSource } from './contextdev';
import { recordedNotice, EGG_RECALL_URL } from './fixture';
import type { Findings } from './findings';
import { ingestRecall, type IngestDeps, type IngestResult } from './ingest';
import { noticeKey, RECALL_LIST_URL } from './recall';

/** At most this many new notices are extracted per change (credits, and the stage). */
export const MAX_NEW_PER_CHANGE = 3;
/** Notices older than this when the change arrives are history, not news. */
export const NEWS_WINDOW_DAYS = 30;

/** Trace callback that also lands in the /ops trace drawer. */
export function busTrace(
	scope: { workspaceId: string; runId: string },
	extra: Record<string, unknown> = {}
): Trace {
	return (step, data) => {
		const e: ServerEvent = traceEvent(scope, step, { ...extra, ...data });
		void publish(scope.workspaceId, [e]).catch(() => {});
	};
}

/** Notice URLs a change points at: search monitors name them; a list-page change means "re-read the list". */
export async function newNoticeUrls(
	change: ChangeDetected['data']['change'] | null,
	recalls: RecallSource,
	findings: Findings,
	now = new Date()
): Promise<string[]> {
	const direct = [...(change?.matched_urls ?? []), ...(change?.added_urls ?? [])].filter((u) =>
		/ruokavirasto\.fi\/.*takaisinved/.test(u)
	);
	const candidates = direct.length
		? direct.map((url) => ({ url, date: null as string | null }))
		: (await recalls.readList({ maxAgeMs: 0 })).flatMap((r) =>
				r.url ? [{ url: r.url, date: r.date }] : []
			);
	const cutoff = now.getTime() - NEWS_WINDOW_DAYS * 86_400_000;
	return candidates
		.filter((c) => !findings.get(`recall:${noticeKey(c.url)}`))
		.filter((c) => !c.date || Date.parse(c.date) >= cutoff)
		.slice(0, MAX_NEW_PER_CHANGE)
		.map((c) => c.url);
}

export async function handleChange(
	body: ChangeDetected,
	deps: IngestDeps & { recalls: RecallSource }
): Promise<IngestResult[]> {
	const change = body.data?.change ?? null;
	const urls = await newNoticeUrls(change, deps.recalls, deps.findings);
	// Fresh reads (the monitor said the page changed), in parallel: at most MAX_NEW_PER_CHANGE.
	const notices = await Promise.all(
		urls.map((url) => deps.recalls.readNotice(url, { maxAgeMs: 0 }))
	);
	const out: IngestResult[] = [];
	for (const notice of notices)
		out.push(
			await ingestRecall(notice, {
				...deps,
				via: `web:contextdev-monitor${change ? `:${change.monitor_id}` : ''}`
			})
		);
	return out;
}

/**
 * Plays a recorded real notice into the current run, labelled "Replay of the <date> recall". With
 * `drillGtin` the notice is re-targeted at a catalogue product so a hold can be shown on stage;
 * the message then says it is a drill.
 */
export async function replayRecorded(
	deps: IngestDeps,
	o: { url?: string; drillGtin?: string } = {}
): Promise<IngestResult> {
	const base = recordedNotice(o.url ?? EGG_RECALL_URL);
	if (!base) throw new Error(`no recorded notice for ${o.url}`);
	const notice = {
		...base,
		replayOf: base.publishedDate ?? base.fetchedAt,
		...(o.drillGtin
			? {
					title: `${base.title} [DRILL: re-targeted at GTIN ${o.drillGtin}]`,
					url: `${base.url}#drill-${o.drillGtin}`,
					products: [{ ...base.products[0], gtin: o.drillGtin }]
				}
			: {})
	};
	return ingestRecall(notice, { ...deps, via: o.drillGtin ? 'web:replay-drill' : 'web:replay' });
}

export { RECALL_LIST_URL };
