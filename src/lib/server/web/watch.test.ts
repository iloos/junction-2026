import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Product } from '$lib/core/contracts';
import { createDbPorts } from '../store/db-ports';
import type { ChangeDetected, RecallSource } from './contextdev';
import { createFixtureRecallSource, EGG_RECALL_URL, recordedNotice } from './fixture';
import { createFindings } from './findings';
import { ingestRecall, lineFor } from './ingest';
import { createWorkQueue } from './queue';
import { diffNotice, memoryIndex, noticeKey, noticeRevision, type RecallNotice } from './recall';
import { drain, enqueueChange, replayRecorded, selectReads, REREAD_AFTER_MS } from './watch';

const product: Product = {
	productId: '464700',
	gtin: '6430017908381',
	nameFi: 'Laitilan Kanatarha Keitetty ja kuorittu kananmuna 1,5kg suojakaasussa',
	vendor: 'MUNAX OY',
	brand: 'Laitilan Kanatarha',
	category: '10101',
	categoryGroup: '10',
	isFood: true,
	labels: [],
	temperatureClass: 'chilled',
	salesUnit: 'ST',
	baseUnit: 'ST',
	packs: [],
	lotStep: 1,
	catchWeight: false,
	allergens: { contains: [], mayContain: [], declared: false },
	freeFrom: [],
	diet: [],
	valioSubstitutes: [],
	dataQualityFlags: []
};
const idx = memoryIndex([product]);
const egg = recordedNotice(EGG_RECALL_URL)!;
/** The egg recall re-targeted at a catalogue GTIN (a GTIN hit), as Ruokavirasto first published it. */
const v1: RecallNotice = { ...egg, products: [{ ...egg.products[0], gtin: product.gtin! }] };
const store = async (runId: string) => (await createDbPorts({ runId })).store;

describe('F20 notice identity and revisions', { timeout: 30_000 }, () => {
	it('the same page read twice is one revision; an added batch is a new one, diffed by item', () => {
		expect(noticeRevision({ ...v1, fetchedAt: 'later' })).toBe(noticeRevision(v1));
		const v2 = { ...v1, products: [{ ...v1.products[0], batch: '1FI15493, 1FI15500' }] };
		expect(noticeRevision(v2)).not.toBe(noticeRevision(v1));
		expect(diffNotice(v1, v2).changed).toEqual([
			expect.objectContaining({ field: 'batch', from: '1FI15493', to: '1FI15493, 1FI15500' })
		]);
	});

	it('an edited notice is recorded as an update naming the change; re-reading it adds nothing', async () => {
		const s = await store('run-rev');
		const deps = {
			store: s,
			index: idx,
			findings: createFindings(undefined, true),
			scope: { workspaceId: 'ws-demo', runId: 'run-rev' }
		};
		const first = await ingestRecall(v1, deps);
		expect(first.recorded).toHaveLength(1);
		expect(first.update).toBeUndefined();

		const v2 = { ...v1, products: [{ ...v1.products[0], batch: '1FI15493, 1FI15500' }] };
		const second = await ingestRecall(v2, deps);
		expect(second.update?.diff.changed[0].field).toBe('batch');
		expect(second.recorded).toHaveLength(1);
		expect(second.recorded[0].id).toContain(`-r${second.revision}-`);
		expect(second.recorded[0].productId).toBe(product.productId);

		const third = await ingestRecall({ ...v2, fetchedAt: 'later' }, deps);
		expect(third.recorded).toEqual([]);
		const f = deps.findings.get(first.findingId)!.data as { revisions: { diff?: string }[] };
		expect(f.revisions).toHaveLength(2);
		expect(f.revisions[1].diff).toMatch(/batch of .*1FI15493 → 1FI15493, 1FI15500/);
	});

	it('a drill has its own namespace: the real notice still records and is still unseen after it', async () => {
		const s = await store('run-drill-ns');
		const findings = createFindings(undefined, true);
		const deps = {
			store: s,
			index: idx,
			findings,
			scope: { workspaceId: 'ws-demo', runId: 'run-drill-ns' }
		};
		const drill = await replayRecorded(deps, { drillGtin: product.gtin });
		expect(drill.recorded[0].id).toMatch(/^recall-drill-/);
		const pick = selectReads({
			candidates: [{ url: EGG_RECALL_URL, date: null }],
			pending: [],
			findings
		});
		expect(pick).toEqual([{ url: EGG_RECALL_URL, reason: 'new' }]);
		const real = await ingestRecall(egg, deps);
		expect(real.findingId).toBe(`recall:${noticeKey(EGG_RECALL_URL)}`);
		expect(real.recorded).toHaveLength(1);
		expect(real.recorded[0].id).not.toBe(drill.recorded[0].id);
	});

	it('a seen recent notice is re-read for edits after 12 h, a seen old one never', () => {
		const findings = createFindings(undefined, true);
		const now = new Date('2026-11-14T12:00:00Z');
		const recent = 'https://www.ruokavirasto.fi/x/takaisinvedot-2023-/recent/';
		const old = 'https://www.ruokavirasto.fi/x/takaisinvedot-2023-/old/';
		for (const url of [recent, old])
			findings.put({
				id: `recall:${noticeKey(url)}`,
				kind: 'recall',
				at: new Date(now.getTime() - REREAD_AFTER_MS - 1).toISOString(),
				title: 't',
				sources: [url],
				data: {}
			});
		const picks = selectReads({
			candidates: [
				{ url: recent, date: '2026-11-10' },
				{ url: old, date: '2026-10-01' }
			],
			pending: [],
			findings,
			now
		});
		expect(picks).toEqual([{ url: recent, reason: 'revision-check' }]);
	});
});

describe('F20 webhook work is never lost', { timeout: 30_000 }, () => {
	const change = (urls: string[] = []): ChangeDetected => ({
		event: 'change.detected',
		id: 'evt_1',
		created_at: '2026-11-14T10:00:00Z',
		data: {
			change: {
				id: 'chg_1',
				monitor_id: 'mon_1',
				title: 't',
				summary: 's',
				detected_at: '2026-11-14T10:00:00Z',
				url: 'u',
				added_urls: urls
			}
		}
	});

	it('the change is on disk before any read, and survives a restart', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'webq-')), 'q.json');
		const q = createWorkQueue(file, true);
		expect(enqueueChange(change(), q)).toEqual(['list']);
		expect(readFileSync(file, 'utf8')).toContain('"kind": "list"');
		expect(createWorkQueue(file, true).has('list')).toBe(true);
		const direct = 'https://www.ruokavirasto.fi/x/takaisinvedot-2023-/new/';
		expect(enqueueChange(change([direct, 'https://elsewhere.fi/']), q)).toEqual([
			`notice:${direct}`
		]);
	});

	it('one failed read keeps its siblings, stays queued, and heals on the next run', async () => {
		const fx = createFixtureRecallSource();
		let flaky = true;
		const recalls: RecallSource = {
			mode: 'fixture',
			readList: () => fx.readList(),
			async readNotice(url, o) {
				if (flaky && /pakastetussa-chilissa/.test(url)) throw new Error('context.dev 502');
				return fx.readNotice(url, o);
			}
		};
		const s = await store('run-heal');
		const queue = createWorkQueue(undefined, true);
		const deps = {
			store: s,
			index: idx,
			findings: createFindings(undefined, true),
			scope: { workspaceId: 'ws-demo', runId: 'run-heal' },
			recalls,
			queue,
			now: () => new Date('2026-11-14T10:00:00Z')
		};
		enqueueChange(change(), queue);
		const r1 = await drain(deps);
		expect(r1.picks).toHaveLength(3);
		expect(r1.results).toHaveLength(2);
		expect(r1.failed).toEqual([
			{ url: expect.stringMatching(/pakastetussa-chilissa/), error: 'context.dev 502' }
		]);
		expect(queue.due().map((w) => w.kind)).toEqual(['notice']);

		flaky = false;
		const r2 = await drain({ ...deps, heal: true }); // the monitor's next run.completed
		expect(r2.picks[0]).toMatchObject({
			reason: 'pending',
			url: expect.stringMatching(/pakastetussa-chilissa/)
		});
		expect(r2.results.some((x) => /pakastetussa-chilissa/.test(x.url))).toBe(true);
		expect(r2.failed).toEqual([]);
		expect(queue.all()).toEqual([]);
	});

	it('a failed list read keeps the change queued', async () => {
		const queue = createWorkQueue(undefined, true);
		enqueueChange(change(), queue);
		const recalls: RecallSource = {
			mode: 'fixture',
			readList: async () => {
				throw new Error('timeout');
			},
			readNotice: async () => {
				throw new Error('unused');
			}
		};
		const r = await drain({
			store: await store('run-list'),
			index: idx,
			findings: createFindings(undefined, true),
			scope: { workspaceId: 'ws-demo', runId: 'run-list' },
			recalls,
			queue
		});
		expect(r.listError).toBe('timeout');
		expect(queue.due()).toEqual([expect.objectContaining({ id: 'list', attempts: 1 })]);
	});
});

describe('F28 recall wording', () => {
	const m = (tier: 'gtin' | 'name', batch: string | null) => ({
		productId: '1',
		productName: 'Kananmuna',
		tier,
		confidence: tier === 'gtin' ? 1 : 0.7,
		recalled: { ...egg.products[0], batch, bestBefore: null },
		why: 'w'
	});
	it('a name match is a potential match and never says every pack counts', () => {
		expect(lineFor(m('name', null))).toMatch(
			/potential match; verify variant and batch on the pack$/
		);
		expect(lineFor(m('name', 'L1'))).toMatch(/potential match; verify variant and batch.*batch L1/);
		expect(lineFor(m('name', null))).not.toMatch(/every pack/);
	});
	it('a GTIN hit without a batch says every pack with this GTIN counts', () => {
		expect(lineFor(m('gtin', null))).toMatch(/every pack with this GTIN counts/);
	});
});
