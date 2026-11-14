/**
 * Recall notice → `RecordAnomaly` ops in the workspace's current run, through the store's `transact`
 * (which publishes them, so /ops shows them live). Anomaly ids are stable per notice, product and plan,
 * so a webhook retry or a second replay adds nothing.
 */
import type { Anomaly, PendingOp, Actor } from '$lib/core/contracts';
import type { Store } from '$lib/core/ports';
import type { WorkspaceState } from '$lib/core/state';
import {
	noticeKey,
	strongMatches,
	type RecallMatch,
	type RecallNotice,
	type CatalogIndex,
	matchNotice
} from './recall';
import type { Findings } from './findings';

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

function lineFor(m: RecallMatch): string {
	const r = m.recalled;
	const bits = [
		r.batch && `batch ${r.batch}`,
		r.bestBefore && `best before ${r.bestBefore}`
	].filter(Boolean);
	const scope = bits.length
		? `potentially affected: orders don't record ${bits.join(', ')}; check the pack`
		: 'affected: the notice gives no batch, so every pack counts';
	return `${m.productName} (${m.why}, confidence ${m.confidence.toFixed(2)}): ${scope}`;
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
	detectedAt: string
): Anomaly[] {
	const key = noticeKey(notice.url);
	const label = notice.replayOf
		? `Replay of the ${dateLabel(notice.publishedDate)} recall`
		: `Recall ${dateLabel(notice.publishedDate)}`;
	const hazard = HAZARD_EN[notice.hazard ?? ''] ?? 'safety issue';
	const head = `${label} (Ruokavirasto): ${notice.title}, ${hazard}.`;
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
	const strong = strongMatches(matches);
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
	if (!strong.length) {
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
	scope: { workspaceId: string; runId: string };
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
}

export async function ingestRecall(notice: RecallNotice, d: IngestDeps): Promise<IngestResult> {
	// Matching reads the catalogue outside the lock (D6: no I/O while transact holds it).
	const matches = await matchNotice(notice, d.index);
	const actor = d.actor ?? { kind: 'system', id: 'web:context.dev' };
	const via = d.via ?? 'web:contextdev';
	const detectedAt = (d.now?.() ?? new Date()).toISOString();
	let produced = 0;
	const r = await d.store.transact(d.scope.workspaceId, async (_tx, state) => {
		const scope = { workspaceId: d.scope.workspaceId, runId: state.runId ?? d.scope.runId };
		const all = recallAnomalies(
			notice,
			matches,
			{ plans: state.plans, anomalies: {} },
			scope,
			detectedAt
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
	if (!r.ok) throw new Error(`recording the recall failed: ${r.error.message}`);
	const recorded = r.value.ops.map((e) => {
		const a = (e.op as { anomaly: Anomaly }).anomaly;
		return { id: a.id, productId: a.productId, planId: a.planId, seq: e.seq };
	});
	const key = noticeKey(notice.url);
	d.findings.put({
		id: `recall:${key}`,
		kind: 'recall',
		at: detectedAt,
		title: notice.title,
		sources: [notice.url],
		ops: recorded.length ? [{ runId: r.value.ops[0].runId, seqs: recorded.map((x) => x.seq) }] : [],
		data: { notice, matches: matches.slice(0, 25) }
	});
	return {
		noticeKey: key,
		url: notice.url,
		matches,
		recorded,
		alreadyKnown: produced - recorded.length
	};
}
