import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Store } from '$lib/core/ports';
import { createFixtureDb } from '../db/pglite';
import type { AnyDb } from '../store/drizzle-store';
import type { RecallSource } from './contextdev';
import { createApplications } from './applications';
import { createFindings } from './findings';
import { attachStateSink, persistedMap, stateWrites } from './persist';
import { createPgWebState } from './pg-state';
import { createWorkQueue, type WorkItem } from './queue';
import { memoryIndex } from './recall';
import { drain } from './watch';

let fixture: Awaited<ReturnType<typeof createFixtureDb>>;
let pg: ReturnType<typeof createPgWebState>;
const url = 'https://example.invalid/recall';
const id = `notice:${url}`;
const at = '2026-11-14T10:00:00Z';
const failingSource = (): RecallSource => ({
	mode: 'fixture',
	readList: async () => [],
	readNotice: async () => {
		throw new Error('notice read timed out');
	}
});
const deps = () => ({
	store: {} as Store,
	index: memoryIndex([]),
	findings: createFindings(undefined, true),
	applications: createApplications(undefined, true),
	scope: { workspaceId: 'ws-queue-worker', runId: 'run-1' },
	queue: createWorkQueue(),
	recalls: failingSource()
});

beforeAll(async () => {
	fixture = await createFixtureDb();
	pg = createPgWebState(fixture.db as unknown as AnyDb);
});
beforeEach(async () => {
	await stateWrites().catch(() => {});
	attachStateSink(null);
	persistedMap<WorkItem>('__webQueue', undefined, (w) => w.id).map.clear();
	await fixture.db.execute(sql`delete from web_queue`);
	attachStateSink(pg);
});
afterEach(async () => {
	await stateWrites().catch(() => {});
	attachStateSink(null);
});
afterAll(async () => {
	await fixture.client.close();
});

describe('recall queue across worker views', () => {
	it('a worker with an empty local queue durably completes work created by another worker', async () => {
		await pg.upsert('__webQueue', 'list', { id: 'list', kind: 'list', at, attempts: 2 });
		const d = deps();
		expect(d.queue.all()).toEqual([]);
		const readList = vi.fn(async () => []);
		await drain({
			...d,
			recalls: { ...d.recalls, readList },
			claim: () => pg.claimWork('worker-b', 10),
			release: () => pg.releaseQueue('worker-b')
		});
		expect(readList).toHaveBeenCalledOnce();
		expect(d.queue.all()).toEqual([]);
		expect(await pg.load('__webQueue')).toEqual([]);
	});

	it('uses current database attempts and change metadata instead of the stale local copy', async () => {
		const d = deps();
		d.queue.add({ kind: 'notice', url, change: 'old-change' });
		await stateWrites();
		await pg.upsert('__webQueue', id, {
			id,
			kind: 'notice',
			url,
			at,
			attempts: 4,
			change: 'new-change'
		});
		const result = await drain({
			...d,
			claim: () => pg.claimWork('worker-b', 10),
			release: () => pg.releaseQueue('worker-b')
		});
		expect(result.failed).toHaveLength(1);
		expect(await pg.load('__webQueue')).toEqual([
			expect.objectContaining({ id, at, attempts: 5, change: 'new-change' })
		]);
		expect(await pg.claimQueue('worker-c', 1)).toEqual([id]);
		await pg.releaseQueue('worker-c');
	});

	it('healing does not complete a list item held by another worker', async () => {
		const d = deps();
		d.queue.add({ kind: 'list' });
		await stateWrites();
		await pg.claimWork('worker-a', 1);
		const readList = vi.fn(async () => []);
		await drain({
			...d,
			recalls: { ...d.recalls, readList },
			heal: true,
			claim: () => pg.claimWork('worker-b', 10),
			release: () => pg.releaseQueue('worker-b')
		});
		expect(readList).toHaveBeenCalledOnce();
		expect((await pg.load('__webQueue')).map((w) => w.id)).toEqual(['list']);
		expect(await pg.claimQueue('worker-c', 1)).toEqual([]);
		await pg.releaseQueue('worker-a');
	});

	it('keeps the lease when a retry disposition cannot be persisted', async () => {
		await pg.upsert('__webQueue', id, { id, kind: 'notice', url, at, attempts: 1 });
		attachStateSink({
			...pg,
			upsert: async () => {
				throw new Error('database unavailable');
			}
		});
		const release = vi.fn(() => pg.releaseQueue('worker-b'));
		await expect(
			drain({ ...deps(), claim: () => pg.claimWork('worker-b', 10), release })
		).rejects.toThrow('persistence failed');
		expect(release).not.toHaveBeenCalled();
		expect(await pg.claimQueue('worker-c', 1)).toEqual([]);
		await pg.releaseQueue('worker-b');
	});

	it('waits for the retry update before handing the lease to another worker', async () => {
		await pg.upsert('__webQueue', id, { id, kind: 'notice', url, at, attempts: 1 });
		let releaseWrite!: () => void;
		const blocked = new Promise<void>((resolve) => (releaseWrite = resolve));
		let began!: () => void;
		const started = new Promise<void>((resolve) => (began = resolve));
		attachStateSink({
			...pg,
			async upsert(...args) {
				began();
				await blocked;
				await pg.upsert(...args);
			}
		});
		const release = vi.fn(() => pg.releaseQueue('worker-b'));
		const pass = drain({ ...deps(), claim: () => pg.claimWork('worker-b', 10), release });
		await started;
		expect(release).not.toHaveBeenCalled();
		expect(await pg.claimQueue('worker-c', 1)).toEqual([]);
		releaseWrite();
		await pass;
		expect(release).toHaveBeenCalledOnce();
		expect(await pg.claimQueue('worker-c', 1)).toEqual([id]);
		await pg.releaseQueue('worker-c');
	});
});
