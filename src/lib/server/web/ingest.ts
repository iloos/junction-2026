/**
 * Recall notice → `RecordAnomaly` ops in the workspace's current run, through the store's `transact`
 * (which publishes them, so /ops shows them live). Anomaly ids are stable per notice identity, revision,
 * product and plan, so a webhook retry or a second replay adds nothing, while an edited notice (a new
 * batch or product) is recorded again as an update that says what changed.
 */
import type { Anomaly, PendingOp, Actor, OpEnvelope, Result } from '$lib/core/contracts';
import type { Store } from '$lib/core/ports';
import type { WorkspaceState } from '$lib/core/state';
import {
	diffNotice,
	noticeIdentity,
	noticeRevision,
	recalledItemKey,
	touchedItems,
	strongMatches,
	type NoticeDiff,
	type RecallMatch,
	type RecallNotice,
	type CatalogIndex,
	matchNotice
} from './recall';
import type { Findings } from './findings';
import { createApplications, type Applications } from './applications';

const HAZARD_EN: Record<string, string> = {
	microbiological: 'microbiological hazard',
	allergen: 'undeclared allergen',
	foreign_body: 'foreign body',
	chemical: 'chemical contamination',
	labelling: 'labelling error',
	contact_material: 'contact material fault',
	other: 'safety issue'
};

function dateLabel(iso: string | null): string {
	if (!iso) return 'undated';
	const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What the chef should do with a matched line. Only a GTIN hit is this product; a name match is a
 * potential match, so it never claims that every pack is affected.
 */
export function lineFor(m: RecallMatch): string {
	const r = m.recalled;
	const bits = [
		r.batch && `batch ${r.batch}`,
		r.bestBefore && `best before ${r.bestBefore}`
	].filter(Boolean);
	const scope =
		m.tier !== 'gtin'
			? `potential match; verify variant and batch on the pack${bits.length ? ` (notice: ${bits.join(', ')})` : ''}`
			: bits.length
				? `potentially affected: orders don't record ${bits.join(', ')}; check the pack`
				: 'affected: the notice gives no batch, so every pack with this GTIN counts';
	return `${m.productName} (${m.why}, confidence ${m.confidence.toFixed(2)}): ${scope}. ${resolution(m)}`;
}

/** The way out of a precautionary hold, in the chef's terms. */
export function resolution(m: Pick<RecallMatch, 'tier' | 'recalled'>): string {
	const codes = [m.recalled.batch, m.recalled.bestBefore].filter(Boolean).length > 0;
	if (m.tier !== 'gtin')
		return 'To resolve: if the pack is a different product or variant, release the line; if it is the same, treat it as recalled and pick a substitute.';
	return codes
		? 'To resolve: if the batch and date on your stock differ from the notice, release the line; if they match or you cannot tell, pick a substitute.'
		: 'To resolve: pick a substitute; release only if the supplier confirms your lot is not affected.';
}

/** "added: X; batch of Y: A → B; removed: Z", for the update message. */
export function diffText(d: NoticeDiff): string {
	const parts = [
		d.added.length && `added ${d.added.map((p) => p.name).join(', ')}`,
		...d.changed.map((c) => `${c.field} of ${c.item.name}: ${c.from ?? '–'} → ${c.to ?? '–'}`),
		d.removed.length && `removed ${d.removed.map((p) => p.name).join(', ')}`
	].filter(Boolean);
	return parts.length ? parts.join('; ') : 'wording changed';
}

/** A re-read that differs from the last recorded read of the same notice. */
export interface NoticeUpdate {
	revision: string;
	diff: NoticeDiff;
}

/**
 * The anomalies a notice produces against this state. Pure: one per strong match per plan that has the
 * product on a line (or one without a plan when no plan has it), else one notice-level anomaly that lists
 * supplier leads without naming a product.
 */
export function recallAnomalies(
	notice: RecallNotice,
	matches: RecallMatch[],
	state: Pick<WorkspaceState, 'plans' | 'anomalies'>,
	scope: { workspaceId: string; runId: string },
	detectedAt: string,
	update?: NoticeUpdate
): Anomaly[] {
	const key = noticeIdentity(notice).id + (update ? `-r${update.revision}` : '');
	const label = notice.replayOf
		? `Replay of the ${dateLabel(notice.publishedDate)} recall`
		: `${update ? 'Updated recall' : 'Recall'} ${dateLabel(notice.publishedDate)}`;
	const hazard = HAZARD_EN[notice.hazard ?? ''] ?? 'safety issue';
	const head = `${label} (Ruokavirasto): ${notice.title}, ${hazard}.${update ? ` Changed: ${diffText(update.diff)}.` : ''}`;
	const provenance = (m?: RecallMatch) => ({
		source: 'web' as const,
		ref: notice.url,
		at: notice.fetchedAt,
		note: [
			'Context.dev structured extraction',
			m ? `match ${m.tier} ${m.confidence.toFixed(2)}` : 'no product match',
			notice.replayOf ? `replay of ${notice.replayOf}` : null
		]
			.filter(Boolean)
			.join('; ')
	});

	const out: Anomaly[] = [];
	// An update re-flags only the products whose recalled item it added or changed.
	const touched = update ? touchedItems(update.diff) : null;
	const strong = strongMatches(matches).filter(
		(m) => !touched || touched.has(recalledItemKey(m.recalled))
	);
	for (const m of strong) {
		const plans = Object.values(state.plans).filter((p) =>
			p.lines.some((l) => l.productId === m.productId)
		);
		const targets = plans.length ? plans.map((p) => p.id) : [undefined];
		for (const planId of targets)
			out.push({
				...scope,
				id: `recall-${key}-${m.productId}-${planId ?? 'catalogue'}`,
				kind: 'recall',
				productId: m.productId,
				...(planId ? { planId } : {}),
				message: `${head} ${lineFor(m)}${planId ? '' : '. Not on any plan in this run.'}`,
				detectedAt,
				provenance: provenance(m)
			});
	}
	if (!strong.length && update) {
		out.push({
			...scope,
			id: `recall-${key}-notice`,
			kind: 'recall',
			message: `${head} No newly affected catalogue product. Nothing new held.`,
			detectedAt,
			provenance: provenance()
		});
	} else if (!strong.length) {
		const leads = matches.filter((m) => m.tier !== 'gtin');
		const named = notice.products
			.map((p) => p.name)
			.slice(0, 4)
			.join(', ');
		const leadText = leads.length
			? ` No GTIN or name match in the catalogue; ${leads.length} catalogue product(s) share the brand or supplier (e.g. ${leads
					.slice(0, 3)
					.map((l) => l.productName)
					.join('; ')}). Nothing held.`
			: ' No catalogue product matches. Nothing held.';
		out.push({
			...scope,
			id: `recall-${key}-notice`,
			kind: 'recall',
			message: `${head} Recalled: ${named}.${leadText}`,
			detectedAt,
			provenance: provenance(leads[0])
		});
	}
	return out.filter((a) => !state.anomalies[a.id]);
}

export interface IngestDeps {
	store: Store;
	index: CatalogIndex;
	findings: Findings;
	/** The target: the notice is applied to this workspace's run. */
	scope: { workspaceId: string; runId: string };
	/** Per-target application ledger; the process-wide one when absent. */
	applications?: Applications;
	actor?: Actor;
	via?: string;
	now?: () => Date;
}

export interface IngestResult {
	noticeKey: string;
	url: string;
	matches: RecallMatch[];
	recorded: { id: string; productId?: string; planId?: string; seq: number }[];
	/** Anomalies that already existed in this run (dedup). */
	alreadyKnown: number;
	/** The finding this read is filed under (`recall:<key>`, or `drill:<ws>:<key>:<gtin>`). */
	findingId: string;
	revision: string;
	/** Set when this revision differs from the one last applied to this target. */
	update?: NoticeUpdate;
}

/** Revisions kept per notice (with the full read, so a target that saw an old one can be diffed). */
export const KEEP_REVISIONS = 5;

/** What the findings keep per notice: the last read, and the recent revisions seen. */
export interface RecallFindingData {
	notice: RecallNotice;
	matches: RecallMatch[];
	revision: string;
	revisions: { revision: string; at: string; diff?: string; notice: RecallNotice }[];
}

/**
 * Applies a notice to the target run. A fresh read is filed first (so a failed apply never costs a
 * second paid read), then applied; the application ledger records the revision applied, or the
 * failure for a retry. `reapply` applies a stored read without touching when it was read.
 */
export async function ingestRecall(
	notice: RecallNotice,
	d: IngestDeps,
	o: { reapply?: boolean } = {}
): Promise<IngestResult> {
	// Matching reads the catalogue outside the lock (D6: no I/O while transact holds it).
	const matches = await matchNotice(notice, d.index);
	const ident = noticeIdentity(notice);
	const revision = noticeRevision(notice);
	const apps = d.applications ?? createApplications();
	const detectedAt = (d.now?.() ?? new Date()).toISOString();

	const prevFinding = d.findings.get(ident.findingId);
	const prev = prevFinding?.data as RecallFindingData | undefined;
	const revisions = (prev?.revisions ?? []).filter((x) => x.notice);
	const data: RecallFindingData = {
		notice,
		matches: matches.slice(0, 25),
		revision,
		revisions: revisions.some((x) => x.revision === revision)
			? revisions
			: [
					...revisions,
					{
						revision,
						at: detectedAt,
						notice,
						...(prev?.notice && prev.revision !== revision
							? { diff: diffText(diffNotice(prev.notice, notice)) }
							: {})
					}
				].slice(-KEEP_REVISIONS)
	};
	const file = (ops: { runId: string; seqs: number[] }[] = []) =>
		d.findings.put({
			id: ident.findingId,
			kind: 'recall',
			at: o.reapply && prevFinding ? prevFinding.at : detectedAt,
			title: notice.title,
			sources: [notice.url.replace(/#.*$/, '')],
			...(notice.drill ? { workspaceId: notice.drill.workspaceId } : {}),
			ops,
			data
		});
	if (!o.reapply || !prevFinding) file();

	const applied = apps.get(d.scope, ident.findingId);
	const base =
		applied?.appliedRevision && applied.appliedRevision !== revision
			? data.revisions.find((x) => x.revision === applied.appliedRevision)?.notice
			: undefined;
	const update: NoticeUpdate | undefined = base
		? { revision, diff: diffNotice(base, notice) }
		: undefined;

	const actor = d.actor ?? { kind: 'system', id: 'web:context.dev' };
	const via = d.via ?? 'web:contextdev';
	let produced = 0;
	let r: Result<{ value: Anomaly[]; ops: OpEnvelope[] }>;
	try {
		r = await d.store.transact(d.scope.workspaceId, async (_tx, state) => {
			const scope = { workspaceId: d.scope.workspaceId, runId: state.runId ?? d.scope.runId };
			const all = recallAnomalies(
				notice,
				matches,
				{ plans: state.plans, anomalies: {} },
				scope,
				detectedAt,
				update
			);
			const fresh = all.filter((a) => !state.anomalies[a.id]);
			produced = all.length;
			const ops: PendingOp[] = fresh.map((anomaly) => ({
				...scope,
				actor,
				via,
				op: { type: 'RecordAnomaly', anomaly }
			}));
			return { ops, value: fresh };
		});
	} catch (e) {
		r = {
			ok: false,
			error: { code: 'INTERNAL', message: String((e as Error)?.message ?? e), retryable: true }
		};
	}
	if (!r.ok) {
		apps.failed(d.scope, ident.findingId, revision, r.error.message, detectedAt);
		throw new Error(`recording the recall failed: ${r.error.message}`);
	}
	const envs = r.value.ops;
	const recorded = envs.map((e) => {
		const a = (e.op as { anomaly: Anomaly }).anomaly;
		return { id: a.id, productId: a.productId, planId: a.planId, seq: e.seq };
	});
	apps.applied(
		d.scope,
		ident.findingId,
		revision,
		recorded.map((x) => x.seq),
		detectedAt
	);
	if (recorded.length) file([{ runId: envs[0].runId, seqs: recorded.map((x) => x.seq) }]);
	return {
		noticeKey: ident.key,
		url: notice.url,
		matches,
		recorded,
		alreadyKnown: produced - recorded.length,
		findingId: ident.findingId,
		revision,
		...(update ? { update } : {})
	};
}
