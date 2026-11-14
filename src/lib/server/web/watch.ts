/**
 * What the monitor's webhooks do. `change.detected` queues the change (durably, before the 202) and
 * works the queue: re-read the list fresh, read notices not seen yet, ingest each. `run.completed`
 * works the queue too and re-reads the list at most hourly, so a failed read heals on the next run and
 * an edited notice is re-read and diffed. Also the presenter replay of a recorded real notice.
 */
import type { ServerEvent } from '$lib/core/contracts';
import { traceEvent, type Trace } from '../adapters/llm/trace';
import { publish } from '../bus';
import type { ChangeDetected, RecallSource } from './contextdev';
import { recordedNotice, EGG_RECALL_URL } from './fixture';
import type { Findings } from './findings';
import { createApplications, MAX_APPLY_ATTEMPTS } from './applications';
import { ingestRecall, type IngestDeps, type IngestResult, type RecallFindingData } from './ingest';
import type { WorkQueue } from './queue';
import { noticeIdentity, noticeKey, RECALL_LIST_URL } from './recall';

/** At most this many notices are read per pass (credits, and the stage). */
export const MAX_NEW_PER_CHANGE = 3;
/** Notices older than this when the change arrives are history, not news. */
export const NEWS_WINDOW_DAYS = 30;
/** Seen notices this recent are re-read now and then, so an edited notice (new batch) is caught. */
export const REVISION_WINDOW_DAYS = 14;
export const REREAD_AFTER_MS = 12 * 3_600_000;
/** `run.completed` re-reads the list at most this often; `change.detected` always reads it fresh. */
export const HEAL_LIST_MAX_AGE_MS = 55 * 60_000;

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

export interface ReadPick {
	url: string;
	/** pending: a read that failed before; new: not seen yet; revision-check: seen, re-read for edits. */
	reason: 'pending' | 'new' | 'revision-check';
}

/**
 * Which notices to read this pass: earlier failures first, then unseen notices inside the news window,
 * then recent seen notices whose last read is old (self-healing and edits). Pure.
 */
export function selectReads(o: {
	candidates: { url: string; date: string | null }[];
	pending: string[];
	findings: Pick<Findings, 'get'>;
	now?: Date;
	max?: number;
}): ReadPick[] {
	const now = (o.now ?? new Date()).getTime();
	const inWindow = (date: string | null, days: number) =>
		!date || Date.parse(date) >= now - days * 86_400_000;
	const seen = (url: string) => o.findings.get(noticeIdentity({ url }).findingId);
	const picks: ReadPick[] = [
		...o.pending.map((url) => ({ url, reason: 'pending' as const })),
		...o.candidates
			.filter((c) => !seen(c.url) && inWindow(c.date, NEWS_WINDOW_DAYS))
			.map((c) => ({ url: c.url, reason: 'new' as const })),
		...o.candidates
			.filter((c) => {
				const f = seen(c.url);
				return (
					f && inWindow(c.date, REVISION_WINDOW_DAYS) && now - Date.parse(f.at) > REREAD_AFTER_MS
				);
			})
			.map((c) => ({ url: c.url, reason: 'revision-check' as const }))
	];
	const keys = new Set<string>();
	return picks
		.filter((p) => {
			const k = noticeKey(p.url);
			return !keys.has(k) && keys.add(k);
		})
		.slice(0, o.max ?? MAX_NEW_PER_CHANGE);
}

const isNoticeUrl = (u: string) => /ruokavirasto\.fi\/.*takaisinved/.test(u);

/**
 * Records what a `change.detected` asks for before anything is read: the notice URLs it names, or a
 * fresh read of the list. Synchronous on disk, so the webhook can answer 202 without losing the change.
 */
export function enqueueChange(body: ChangeDetected, queue: WorkQueue): string[] {
	const change = body.data?.change ?? null;
	const direct = [...(change?.matched_urls ?? []), ...(change?.added_urls ?? [])].filter(
		isNoticeUrl
	);
	return direct.length
		? direct.map((url) => queue.add({ kind: 'notice', url, change: change?.id }))
		: [queue.add({ kind: 'list', change: change?.id })];
}

export interface DrainResult {
	picks: ReadPick[];
	results: IngestResult[];
	/** Stored reads applied to this target without a new read (a new run, a retried apply). */
	applied: IngestResult[];
	failed: { url: string; error: string }[];
	listError?: string;
	/** Work still queued after this pass. */
	queued: number;
}

export type DrainDeps = IngestDeps & {
	recalls: RecallSource;
	queue: WorkQueue;
	/** `run.completed`: re-read the list (cached up to an hour) even with nothing queued. */
	heal?: boolean;
};

let tail: Promise<unknown> = Promise.resolve();

/**
 * One pass over the queue. Passes run one at a time per process, so two webhooks never read and
 * ingest the same notice at once. A read or ingest that fails stays queued; its siblings still land.
 */
export function drain(d: DrainDeps): Promise<DrainResult> {
	const run = tail.then(() => drainOnce(d));
	tail = run.catch(() => {});
	return run;
}

async function drainOnce(d: DrainDeps): Promise<DrainResult> {
	const due = d.queue.due();
	const listQueued = due.some((w) => w.kind === 'list');
	const pending = due.flatMap((w) => (w.kind === 'notice' && w.url ? [w.url] : []));
	let candidates: { url: string; date: string | null }[] = [];
	let listError: string | undefined;
	if (listQueued || d.heal) {
		try {
			candidates = (
				await d.recalls.readList({ maxAgeMs: listQueued ? 0 : HEAL_LIST_MAX_AGE_MS })
			).flatMap((r) => (r.url && isNoticeUrl(r.url) ? [{ url: r.url, date: r.date }] : []));
			d.queue.done('list');
		} catch (e) {
			listError = errorText(e);
			if (listQueued) d.queue.failed('list', listError);
		}
	}
	const picks = selectReads({ candidates, pending, findings: d.findings, now: d.now?.() });
	// Fresh reads, in parallel; one failure never drops its siblings.
	const reads = await Promise.allSettled(
		picks.map((p) => d.recalls.readNotice(p.url, { maxAgeMs: 0 }))
	);
	const results: IngestResult[] = [];
	const failed: DrainResult['failed'] = [];
	for (const [i, r] of reads.entries()) {
		const url = picks[i].url;
		const id = `notice:${url}`;
		try {
			if (r.status === 'rejected') throw r.reason;
			results.push(await ingestRecall(r.value, d));
			d.queue.done(id);
		} catch (e) {
			const error = errorText(e);
			failed.push({ url, error });
			d.queue.failed(id, error, { kind: 'notice', url });
		}
	}
	const applied = await applyKnown(d, new Set(results.map((x) => x.findingId)));
	return {
		picks,
		results,
		applied,
		failed,
		...(listError ? { listError } : {}),
		queued: d.queue.due().length
	};
}

/**
 * Applies every recent public notice already read to the target run when its latest revision isn't
 * applied there yet: a reset run or a workspace that joined later gets the recalls without a paid
 * read, and a failed apply is retried (up to MAX_APPLY_ATTEMPTS). No network.
 */
export async function applyKnown(d: DrainDeps | IngestDeps, skip = new Set<string>()) {
	const apps = d.applications ?? createApplications();
	const now = (d.now?.() ?? new Date()).getTime();
	const out: IngestResult[] = [];
	for (const f of d.findings.list('recall')) {
		if (f.workspaceId || skip.has(f.id)) continue;
		const data = f.data as Partial<RecallFindingData> | undefined;
		if (!data?.notice || !data.revision) continue;
		const date = data.notice.publishedDate ?? f.at;
		if (Date.parse(date) < now - NEWS_WINDOW_DAYS * 86_400_000) continue;
		const a = apps.get(d.scope, f.id);
		if (a?.appliedRevision === data.revision) continue;
		if (a?.state === 'failed' && a.revision === data.revision && a.attempts >= MAX_APPLY_ATTEMPTS)
			continue;
		try {
			out.push(await ingestRecall(data.notice, d, { reapply: true }));
		} catch {
			// Recorded as a failed application; tried again on the next pass.
		}
	}
	return out;
}

const errorText = (e: unknown) => String((e as Error)?.message ?? e);

/** `change.detected`: queue the change, then work the queue. */
export async function handleChange(body: ChangeDetected, d: DrainDeps): Promise<DrainResult> {
	enqueueChange(body, d.queue);
	return drain(d);
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
					drill: { gtin: o.drillGtin, workspaceId: deps.scope.workspaceId },
					products: [{ ...base.products[0], gtin: o.drillGtin }]
				}
			: {})
	};
	return ingestRecall(notice, { ...deps, via: o.drillGtin ? 'web:replay-drill' : 'web:replay' });
}

export { RECALL_LIST_URL };
