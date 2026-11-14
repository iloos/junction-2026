/**
 * F20 acceptance: a notice's source version, its application per workspace/run with retry state, an
 * amended notice at the same URL, a new run, and the evidence a precautionary hold carries.
 */
import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import type { Store } from '$lib/core/ports';
import { createDbPorts } from '../store/db-ports';
import { createApplications } from './applications';
import type { RecallSource } from './contextdev';
import { EGG_RECALL_URL, recordedNotice } from './fixture';
import { createFindings } from './findings';
import { ingestRecall } from './ingest';
import { createWorkQueue } from './queue';
import { memoryIndex, type RecallNotice } from './recall';
import { applyKnown, drain, enqueueChange } from './watch';

const product = {
	productId: '464700',
	gtin: '6430017908381',
	nameFi: 'Laitilan Kanatarha Keitetty ja kuorittu kananmuna 1,5kg suojakaasussa',
	vendor: 'MUNAX OY',
	brand: 'Laitilan Kanatarha',
	allergens: { contains: [], mayContain: [], declared: false }
} as unknown as Product;
const idx = memoryIndex([product]);
const egg = recordedNotice(EGG_RECALL_URL)!;
/** The egg notice as a GTIN hit on a catalogue product, published recently. */
const v1: RecallNotice = {
	...egg,
	publishedDate: '2026-11-13',
	products: [{ ...egg.products[0], gtin: product.gtin! }]
};
const v2: RecallNotice = { ...v1, products: [{ ...v1.products[0], batch: '1FI15493, 1FI15500' }] };
const NOW = new Date('2026-11-14T10:00:00Z');

/** One PGlite for run A across the file; each test works in its own workspace. */
let shared: ReturnType<typeof createDbPorts> | undefined;
let n = 0;

async function setup() {
	const env = await (shared ??= createDbPorts({ runId: 'run-a' }));
	const ws = `ws-apply-${++n}`;
	runA.workspaceId = ws;
	runB.workspaceId = ws;
	return {
		store: env.store,
		index: idx,
		findings: createFindings(undefined, true),
		applications: createApplications(undefined, true),
		now: () => NOW
	};
}
const runA = { workspaceId: '', runId: 'run-a' };
const runB = { workspaceId: '', runId: 'run-b' };
const noReads: RecallSource = {
	mode: 'fixture',
	readList: async () => {
		throw new Error('no read expected');
	},
	readNotice: async () => {
		throw new Error('no read expected');
	}
};
const anomaliesIn = async (store: Store, runId: string) =>
	Object.values((await store.load(runA.workspaceId, runId)).anomalies);

describe('F20 applications per workspace and run', { timeout: 30_000 }, () => {
	it('an amended notice at the same URL is re-read by the watch and recorded as a new version', async () => {
		const base = await setup();
		let served = v1;
		const recalls: RecallSource = {
			mode: 'fixture',
			readList: async () => [{ title: v1.title, url: EGG_RECALL_URL, date: '2026-11-13' }],
			readNotice: async () => served
		};
		const queue = createWorkQueue(undefined, true);
		enqueueChange(
			{
				event: 'change.detected',
				id: 'e',
				created_at: '',
				data: {
					change: {
						id: 'c',
						monitor_id: 'm',
						title: '',
						summary: '',
						detected_at: '',
						url: ''
					}
				}
			},
			queue
		);
		const first = await drain({ ...base, scope: runA, recalls, queue });
		expect(first.results[0]).toMatchObject({ recorded: [expect.anything()] });
		expect(first.results[0].update).toBeUndefined();

		served = v2; // Ruokavirasto adds a batch to the same page
		const later = new Date(NOW.getTime() + 13 * 3_600_000);
		const second = await drain({
			...base,
			scope: runA,
			recalls,
			queue,
			heal: true,
			now: () => later
		});
		expect(second.picks).toEqual([{ url: EGG_RECALL_URL, reason: 'revision-check' }]);
		const upd = second.results[0];
		expect(upd.update?.diff.changed.map((c) => c.field)).toEqual(['batch']);
		expect(upd.recorded).toHaveLength(1);
		const versions = (base.findings.get(upd.findingId)!.data as { revisions: unknown[] }).revisions;
		expect(versions).toHaveLength(2);
		const msgs = (await anomaliesIn(base.store, 'run-a')).map((a) => a.message);
		expect(msgs.some((m) => /^Updated recall .*Changed: batch of /.test(m))).toBe(true);
	});

	it('a new run gets the stored notice applied without a read, then later versions as updates', async () => {
		const base = await setup();
		await ingestRecall(v1, { ...base, scope: runA });
		const queue = createWorkQueue(undefined, true);
		// The test store pins one run per database; run B is a second one (prod follows the current run).
		const storeB = (await createDbPorts({ runId: 'run-b' })).store;
		const b = { ...base, store: storeB, scope: runB };

		const b1 = await drain({ ...b, recalls: noReads, queue });
		expect(b1.results).toEqual([]);
		expect(b1.applied).toHaveLength(1);
		expect(b1.applied[0].update).toBeUndefined(); // fresh in run B
		expect(await anomaliesIn(storeB, 'run-b')).toHaveLength(1);
		expect((await drain({ ...b, recalls: noReads, queue })).applied).toEqual([]);

		await ingestRecall(v2, { ...base, scope: runA }); // amended, read in run A
		const b2 = await applyKnown(b);
		expect(b2[0].update?.diff.changed[0].field).toBe('batch');
		expect(base.applications.get(runB, b2[0].findingId)).toMatchObject({
			state: 'applied',
			appliedRevision: b2[0].revision
		});
	});

	it('a failed application keeps its retry state and is applied on the next pass', async () => {
		const base = await setup();
		let fail = true;
		const store: Store = {
			...base.store,
			transact: (async (ws: string, fn: never) => {
				if (fail) throw new Error('db down');
				return base.store.transact(ws, fn);
			}) as Store['transact']
		};
		await expect(ingestRecall(v1, { ...base, store, scope: runA })).rejects.toThrow(/db down/);
		const app = base.applications.get(
			runA,
			`recall:${(await import('./recall')).noticeKey(v1.url)}`
		);
		expect(app).toMatchObject({
			state: 'failed',
			attempts: 1,
			lastError: expect.stringMatching(/db down/)
		});
		expect(base.findings.list('recall')).toHaveLength(1); // the read is kept: no second paid read

		fail = false;
		const r = await applyKnown({ ...base, store, scope: runA });
		expect(r).toHaveLength(1);
		expect(r[0].recorded).toHaveLength(1);
	});

	it('a precautionary hold carries its evidence and a resolution path', async () => {
		const base = await setup();
		const r = await ingestRecall(v1, { ...base, scope: runA });
		const [a] = (await anomaliesIn(base.store, 'run-a')).filter((x) => x.id === r.recorded[0].id);
		expect(a.productId).toBe(product.productId);
		expect(a.provenance).toMatchObject({ source: 'web', ref: EGG_RECALL_URL });
		expect(a.provenance?.note).toMatch(/match gtin 1\.00/);
		expect(a.message).toMatch(/GTIN 6430017908381 is on the notice/);
		expect(a.message).toMatch(
			/To resolve: if the batch and date on your stock differ from the notice, release the line/
		);
	});
});

describe('sandbox recalls (visitor workspace, no network)', { timeout: 30_000 }, () => {
	it('applies a stored public notice to the new sandbox run and files a labelled drill there', async () => {
		const { sandboxRecalls } = await import('./sandbox');
		const base = await setup();
		// The monitor read the notice for the demo workspace earlier.
		await ingestRecall(v1, { ...base, scope: { workspaceId: 'ws-demo-src', runId: 'run-a' } });
		const r = await sandboxRecalls({ ...base, scope: runA }, { drillGtin: product.gtin! });
		expect(r.applied).toHaveLength(1);
		expect(r.drill).not.toBeNull();
		expect(r.note).toMatch(/1 stored public notice\(s\) applied; one labelled DRILL/);
		const anomalies = await anomaliesIn(base.store, 'run-a');
		expect(anomalies.length).toBeGreaterThanOrEqual(2);
		expect(
			base.findings.list('recall', runA.workspaceId).some((f) => f.id.startsWith('drill:'))
		).toBe(true);
	});
});
