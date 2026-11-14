import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '../contracts';
import { causeOf } from './cause';
import { orderStages } from './stages';

const r = (...reasons: string[]) => ({ reasons }) as never;

describe('why a line cannot be ordered, and who said so', () => {
	it('a hard requirement is the kitchen’s rule, never Valio’s stock', () => {
		expect(causeOf(r('requirement_unmet'))).toMatchObject({ by: 'kitchen', shortage: false });
		expect(causeOf(r('requirement_unmet')).text).not.toMatch(/stock|Valio/);
		expect(causeOf(r('allergen_declared')).by).toBe('kitchen');
		expect(causeOf(r('over_hard_limit')).by).toBe('kitchen');
		expect(causeOf(r('CAP_EXCEEDED.weekly')).by).toBe('kitchen');
	});
	it('a fact gap or a passed cut-off belongs to the order', () => {
		expect(causeOf(r('price_missing'))).toMatchObject({ by: 'order', shortage: false });
		expect(causeOf(r('cutoff_passed')).by).toBe('order');
	});
	it('only a stock, delivery or sales-block reason is Valio’s, and only those are a shortage', () => {
		expect(causeOf(r('out'))).toMatchObject({
			by: 'valio',
			shortage: true,
			text: 'is out of stock at Valio'
		});
		expect(causeOf(r('undeliverable'))).toMatchObject({ by: 'valio', shortage: true });
		expect(causeOf(r('blocked')).by).toBe('valio');
		expect(causeOf(r('INSUFFICIENT_STOCK')).shortage).toBe(true);
	});
	it('an unknown reason is said as itself, never guessed as stock', () => {
		expect(causeOf(r('new_reason'))).toMatchObject({ by: 'order', shortage: false });
		expect(causeOf(r('new_reason')).text).toContain('new reason');
	});
});

describe('the Orders story says the typed cause', () => {
	const ops = readFileSync('src/routes/ops/fixtures/seeded-ops.ndjson', 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => JSON.parse(l) as OpEnvelope);
	const planId = (ops[0].op as { plan: { id: string } }).plan.id;

	it('the ham refused for a requirement (with stock at Valio) reads as the kitchen’s rule', () => {
		const changed = ops.map((e) => {
			if (e.op.type !== 'RecordOffer') return e;
			const lines = e.op.lines.map((l) =>
				l.productId === '462490' ? { ...l, reasons: ['requirement_unmet' as const] } : l
			);
			return { ...e, op: { ...e.op, lines } } as OpEnvelope;
		});
		const s = orderStages(planId, changed)!;
		const ham = s.proposed.changes.find((c) =>
			c.lineIds.some((id) => id.endsWith('need:joulukinkku'))
		)!;
		expect(ham).toMatchObject({ kind: 'rule', by: 'kitchen' });
		expect(ham.text).not.toMatch(/out of stock/);
		// The real outages stay Valio's.
		const outs = s.proposed.changes.filter((c) => c.kind === 'out');
		expect(outs.every((c) => c.by === 'valio' && /out of stock at Valio/.test(c.text))).toBe(true);
	});
});
