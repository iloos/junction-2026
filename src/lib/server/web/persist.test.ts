import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	attachStateSink,
	hydrateSlot,
	persistedMap,
	retryStateWrites,
	stateWrites,
	type StateSink
} from './persist';

type Doc = { id: string; value: number; nested?: { value: number } };
const queue = () => persistedMap<Doc>('__webQueue', undefined, (d) => d.id);

beforeEach(async () => {
	await stateWrites().catch(() => {});
	attachStateSink(null);
	queue().map.clear();
	persistedMap<Doc>('__webApplications', undefined, (d) => d.id).map.clear();
});
afterEach(async () => {
	await stateWrites().catch(() => {});
	attachStateSink(null);
});

function memorySink() {
	const rows = new Map<string, Record<string, unknown>>();
	const sink: StateSink = {
		async upsert(_slot, id, doc) {
			rows.set(id, structuredClone(doc));
		},
		async remove(_slot, id) {
			rows.delete(id);
		}
	};
	return { rows, sink };
}

describe('durable web state writes', () => {
	it('rejects a failed upsert and retries the unchanged document', async () => {
		const { rows, sink } = memorySink();
		let unavailable = true;
		let attempts = 0;
		attachStateSink({
			...sink,
			async upsert(...args) {
				attempts++;
				if (unavailable) throw new Error('offline');
				await sink.upsert(...args);
			}
		});
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		await expect(stateWrites()).rejects.toThrow('persistence failed');
		expect(rows.has('notice')).toBe(false);
		unavailable = false;
		q.flush();
		await stateWrites();
		expect(attempts).toBe(2);
		expect(rows.get('notice')).toEqual({ id: 'notice', value: 1 });
	});

	it('retains failed deletions until the same empty snapshot is persisted', async () => {
		const { rows, sink } = memorySink();
		let unavailable = false;
		attachStateSink({
			...sink,
			async remove(...args) {
				if (unavailable) throw new Error('offline');
				await sink.remove(...args);
			}
		});
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		await stateWrites();
		unavailable = true;
		q.map.delete('notice');
		q.flush();
		await expect(stateWrites()).rejects.toThrow();
		expect(rows.has('notice')).toBe(true);
		unavailable = false;
		q.flush();
		await stateWrites();
		expect(rows.has('notice')).toBe(false);
	});

	it('serializes overlapping flushes so an older write cannot finish last', async () => {
		const { rows, sink } = memorySink();
		const calls: number[] = [];
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		let began!: () => void;
		const started = new Promise<void>((resolve) => (began = resolve));
		attachStateSink({
			...sink,
			async upsert(slot, id, doc) {
				calls.push(Number(doc.value));
				if (doc.value === 1) {
					began();
					await blocked;
				}
				await sink.upsert(slot, id, doc);
			}
		});
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		await started;
		q.map.set('notice', { id: 'notice', value: 2 });
		q.flush();
		await Promise.resolve();
		expect(calls).toEqual([1]);
		release();
		await stateWrites();
		expect(calls).toEqual([1, 2]);
		expect(rows.get('notice')?.value).toBe(2);
	});

	it('captures the document at flush time, including nested values', async () => {
		const { rows, sink } = memorySink();
		attachStateSink(sink);
		const q = queue();
		const doc = { id: 'notice', value: 1, nested: { value: 1 } };
		q.map.set(doc.id, doc);
		q.flush();
		doc.nested.value = 2;
		await stateWrites();
		expect(rows.get(doc.id)?.nested).toEqual({ value: 1 });
		q.flush();
		await stateWrites();
		expect(rows.get(doc.id)?.nested).toEqual({ value: 2 });
	});

	it('deletes a remotely committed insert whose acknowledgement was lost', async () => {
		const { rows, sink } = memorySink();
		attachStateSink({
			...sink,
			async upsert(...args) {
				await sink.upsert(...args);
				throw new Error('acknowledgement lost');
			}
		});
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		await expect(stateWrites()).rejects.toThrow();
		expect(rows.has('notice')).toBe(true);
		q.map.delete('notice');
		q.flush();
		await stateWrites();
		expect(rows.has('notice')).toBe(false);
	});

	it('deletes after a pending insert even before that insert is acknowledged', async () => {
		const { rows, sink } = memorySink();
		attachStateSink(sink);
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		q.map.delete('notice');
		q.flush();
		await stateWrites();
		expect(rows.size).toBe(0);
	});

	it('uses the database baseline when hydration preserves a newer local edit', async () => {
		const { rows, sink } = memorySink();
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 2 });
		hydrateSlot('__webQueue', q.map, [{ id: 'notice', value: 1 }], (d) => d.id);
		attachStateSink(sink);
		q.flush();
		await stateWrites();
		expect(q.map.get('notice')?.value).toBe(2);
		expect(rows.get('notice')?.value).toBe(2);
	});

	it('retries only the failed row after a partially successful batch', async () => {
		const { sink } = memorySink();
		const calls: string[] = [];
		let unavailable = true;
		attachStateSink({
			...sink,
			async upsert(slot, id, doc) {
				calls.push(id);
				if (id === 'failed' && unavailable) throw new Error('offline');
				await sink.upsert(slot, id, doc);
			}
		});
		const q = queue();
		q.map.set('saved', { id: 'saved', value: 1 });
		q.map.set('failed', { id: 'failed', value: 1 });
		q.flush();
		await expect(stateWrites()).rejects.toThrow();
		unavailable = false;
		await retryStateWrites();
		expect(calls).toEqual(['saved', 'failed', 'failed']);
	});

	it('does not hide an unresolved slot failure behind a different successful slot', async () => {
		const { sink } = memorySink();
		let unavailable = true;
		attachStateSink({
			...sink,
			async upsert(slot, id, doc) {
				if (slot === '__webQueue' && unavailable) throw new Error('queue unavailable');
				await sink.upsert(slot, id, doc);
			}
		});
		const q = queue();
		q.map.set('notice', { id: 'notice', value: 1 });
		q.flush();
		await expect(stateWrites()).rejects.toThrow();
		const applications = persistedMap<Doc>('__webApplications', undefined, (d) => d.id);
		applications.map.set('applied', { id: 'applied', value: 1 });
		applications.flush();
		await expect(stateWrites()).rejects.toThrow();
		unavailable = false;
		await retryStateWrites();
		expect(q.map.size).toBe(1);
	});
});
