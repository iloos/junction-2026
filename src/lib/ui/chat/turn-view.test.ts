import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from './types';
import { foldRows, outcomeLine, stepsSinceChef, workedLine, type Entry } from './turn-view';

/** A recorded task (fixture LLM): "I need butter" → qty clarify → date clarify with options → steps, decision, ledger. */
const entries: Entry[] = readFileSync(
	new URL('./fixtures/butter-turn.ndjson', import.meta.url),
	'utf8'
)
	.trim()
	.split('\n')
	.map((l, i) => {
		const o = JSON.parse(l) as { chef?: string } & ChatEvent;
		return o.chef !== undefined
			? { kind: 'chef', text: o.chef, at: i * 1000 }
			: { kind: 'event', e: o, at: i * 1000 };
	});
const rows = foldRows(entries);
const events = rows.flatMap((r) => (r.kind === 'entry' && r.x.kind === 'event' ? [r.x.e] : []));

describe('a recorded chat turn renders as five parts', () => {
	it("folds the turn's tool steps into one timed line", () => {
		const steps = rows.filter((r) => r.kind === 'steps');
		expect(steps).toHaveLength(1);
		const s = steps[0] as Extract<(typeof rows)[number], { kind: 'steps' }>;
		expect(s.steps.map((x) => x.tool)).toEqual(['search_products', 'quote', 'place_order']);
		expect(workedLine(s)).toMatch(/^Worked 3 steps · \d+\.\d s$/);
		expect(events.some((e) => e.type === 'step')).toBe(false);
	});
	it("keeps clarify options as chips and the chef's answers as messages", () => {
		const clarify = events.filter((e) => e.type === 'clarify');
		expect(clarify.map((c) => c.type === 'clarify' && c.options.length)).toEqual([0, 5]);
		const chef = rows.flatMap((r) => (r.kind === 'entry' && r.x.kind === 'chef' ? [r.x.text] : []));
		expect(chef).toEqual(['I need butter', '4 kg', 'Thursday 12-10']);
	});
	it('carries a decision with a consequence title and a Kitchen link, never an approval', () => {
		const d = events.find((e) => e.type === 'decision');
		expect(d?.type === 'decision' && d.decisions.length).toBe(1);
		if (d?.type !== 'decision') return;
		expect(d.approvalUrl).toMatch(/[?&]plan=/);
		expect(d.decisions[0].title).toBe('Buy 1 new product');
	});
	it('ends with one outcome line from the ledger', () => {
		const l = events.find((e) => e.type === 'ledger');
		expect(l?.type === 'ledger' && outcomeLine(l.ledger)).toBe(
			'1 decision for a chef · nothing ordered'
		);
	});
	it('times a running turn by the steps since the chef spoke', () => {
		expect(stepsSinceChef(entries)).toBe(3);
		expect(stepsSinceChef(entries.slice(0, 2))).toBe(0);
	});
});
