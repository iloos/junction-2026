import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '../contracts';
import { allOrderStages, orderStages } from './stages';

/** The seeded Christmas run of a fresh visitor (routes/ops/fixtures), as the op stream delivered it. */
const ops = readFileSync('src/routes/ops/fixtures/seeded-ops.ndjson', 'utf8')
	.trim()
	.split(/\r?\n/)
	.map((l) => JSON.parse(l) as OpEnvelope);
const planId = (ops[0].op as { plan: { id: string } }).plan.id;

describe('order stages on the seeded run', () => {
	const s = orderStages(planId, ops)!;

	it('asks for the dishes with their basis', () => {
		expect(s.origin).toBe('event');
		expect(s.asked.needs.length).toBe(13);
		const ham = s.asked.needs.find((n) => n.needId === 'need:joulukinkku')!;
		expect(ham.basis).toMatch(/×/);
		expect(ham.amount.unit).toBe('kg');
	});

	it('says what the agents changed and why, one sentence each, in seq order', () => {
		const kinds = s.proposed.changes.map((c) => c.kind);
		expect(kinds.filter((k) => k === 'out')).toHaveLength(2);
		expect(kinds).toContain('undeliverable');
		expect(kinds.filter((k) => k === 'make_in_house')).toHaveLength(2);
		expect(kinds).toContain('substitute');
		const sub = s.proposed.changes.find((c) => c.kind === 'substitute')!;
		expect(sub.text).toMatch(
			/^Proposed .+ instead of .+, ranked first of \d+ candidates by the kitchen's own rules\.$/
		);
		const seqs = s.proposed.changes.map((c) => c.seq);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
		for (const c of s.proposed.changes) expect(c.text).not.toMatch(/undefined|Product \d|NaN/);
		expect(s.proposed.unchanged).toBeGreaterThan(0);
		expect(s.proposed.unchanged).toBeLessThan(s.proposed.lines);
	});

	it('lists every approval with its version and terms; nothing ordered yet', () => {
		expect(s.signed.length).toBeGreaterThanOrEqual(1);
		const open = s.signed.filter((a) => a.state === 'pending');
		expect(open).toHaveLength(1);
		expect(open[0].planVersion).toBe(s.version);
		expect(open[0].termsHash).toBeTruthy();
		expect(s.ordered).toEqual([]);
		expect(s.held.lines).toBe(14);
		expect(s.held.cents).toBeGreaterThan(0);
	});

	it('finds every plan in the log', () => {
		expect(allOrderStages(ops).map((x) => x.planId)).toEqual([planId]);
		expect(orderStages('pl-nope', ops)).toBeNull();
	});
});

describe('order stages on an ordered plan', () => {
	/** An outside agent orders by line; its own commit is refused; the chef signs; the order is placed. */
	const ordered = readFileSync('src/lib/core/services/fixtures/ordered-ops.ndjson', 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => JSON.parse(l) as OpEnvelope);
	const id = (ordered[0].op as { plan: { id: string } }).plan.id;
	const s = orderStages(id, ordered)!;

	it('asks by line when the plan has no needs, and came from an outside agent', () => {
		expect(s.origin).toBe('outside_agent');
		expect(s.asked.needs).toEqual([]);
		expect(s.asked.lines).toHaveLength(1);
		expect(s.asked.lines[0].qty).toMatchObject({ value: 3, unit: 'KI' });
	});

	it('records who signed which version, and what the supplier confirmed', () => {
		const granted = s.signed.filter((a) => a.state === 'granted');
		expect(granted).toHaveLength(1);
		expect(granted[0].decidedBy).toBe('chef');
		expect(granted[0].requestedBy).toBe('external_agent');
		expect(s.ordered).toHaveLength(1);
		expect(s.ordered[0].planVersion).toBe(granted[0].planVersion);
		expect(s.ordered[0].lines.map((l) => l.status)).toEqual(['confirmed']);
		expect(s.orderedCents).toBe(s.ordered[0].totalCents);
		expect(s.held.lines).toBe(0);
		expect(s.pending).toBeNull();
	});
});
