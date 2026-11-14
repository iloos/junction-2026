import { describe, expect, it } from 'vitest';
import { ServerEvent } from '$lib/core/contracts';
import { applyOps, emptyState } from '$lib/core/state';
import { MemoryBus, RING_SIZE } from './memory';
import { SYNTH_WORKSPACE, syntheticRun } from './synthetic';

describe('synthetic run', () => {
	const events = syntheticRun({ runId: 'synth-1', startSeq: 1 });

	it('is valid ServerEvents with contiguous seqs', () => {
		for (const e of events) expect(ServerEvent.safeParse(e).error).toBeUndefined();
		expect(events.map((e) => ('seq' in e ? e.seq : 0))).toEqual(events.map((_, i) => i + 1));
	});

	it('reduces through applyOps without error', () => {
		const ops = events.flatMap((e) => (e.kind === 'op' ? [e.envelope] : []));
		const r = applyOps(emptyState(SYNTH_WORKSPACE, 'synth-1'), ops);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		const s = r.value;
		expect(Object.keys(s.orders).sort()).toEqual(['o-central', 'o-lounas']);
		expect(s.plans['p-lounas'].state).toBe('committed');
		expect(s.plans['p-hotel'].lines.filter((l) => l.state === 'held').map((l) => l.id)).toEqual([
			'h-casserole',
			'h-trout'
		]);
		expect(s.failedCommits).toHaveLength(1);
	});
});

describe('MemoryBus', () => {
	const op = (seq: number) =>
		syntheticRun({ runId: 'r', startSeq: seq })[0] as Extract<ServerEvent, { kind: 'op' }>;

	it('replays after a seq, dedupes, and delivers live', () => {
		const bus = new MemoryBus();
		const seen: number[] = [];
		bus.subscribe('w', (e) => 'seq' in e && seen.push(e.seq));
		bus.deliver('w', [op(1), op(2), op(2), op(3)]);
		expect(seen).toEqual([1, 2, 3]);
		expect(bus.after('w', 1).map((e) => e.seq)).toEqual([2, 3]);
		expect(bus.highestSeq('w')).toBe(3);
	});

	it('keeps only the last RING_SIZE events', () => {
		const bus = new MemoryBus();
		bus.deliver(
			'w',
			Array.from({ length: RING_SIZE + 20 }, (_, i) => op(i + 1))
		);
		const kept = bus.after('w', 0);
		expect(kept).toHaveLength(RING_SIZE);
		expect(kept[0].seq).toBe(21);
	});

	it('unsubscribes', () => {
		const bus = new MemoryBus();
		const off = bus.subscribe('w', () => {});
		expect(bus.listenerCount('w')).toBe(1);
		off();
		expect(bus.listenerCount('w')).toBe(0);
	});
});

describe('stress events', () => {
	it('10 interleaved copies reduce through applyOps without error', async () => {
		const { stressEvents, STRESS_WORKSPACE } = await import('./stress');
		const events = stressEvents(10);
		const ops = events.flatMap((e) => (e.kind === 'op' ? [e.envelope] : []));
		const r = applyOps(emptyState(STRESS_WORKSPACE, 'stress-1'), ops);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(Object.keys(r.value.plans)).toHaveLength(30);
		expect(Object.keys(r.value.orders)).toHaveLength(20);
	});
});
