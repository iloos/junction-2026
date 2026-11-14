import { describe, expect, it } from 'vitest';
import type { Line, Plan } from '../contracts';
import { lineView } from './view';

const line = (o: Partial<Line>): Line =>
	({
		id: 'l1',
		needId: 'n1',
		productId: 'p1',
		qty: { value: 2, unit: 'ST' },
		state: 'held',
		tier: 'review',
		reasons: [],
		offer: null,
		lineCents: 100,
		provenance: { source: 'user' },
		...o
	}) as Line;
const plan = (l: Line): Plan => ({ id: 'p', version: 3, lines: [l] }) as unknown as Plan;

describe('lineView next action', () => {
	it('a line closed only by its cut-off asks for a later date', () => {
		const l = line({ state: 'unorderable', reasons: ['cutoff_passed'] });
		expect(lineView(l, plan(l), null)).toMatchObject({ nextAction: 'change_date' });
	});

	it('out and past the cut-off still needs a substitute', () => {
		const l = line({ state: 'unorderable', reasons: ['out', 'cutoff_passed'] });
		expect(lineView(l, plan(l), null).nextAction).toBe('find_substitute');
	});

	it('a held line with a granted approval on this version is committable', () => {
		const l = line({ reasons: ['new_sku'] });
		const v = lineView(l, plan(l), { state: 'granted', lineIds: ['l1'], planVersion: 3 });
		expect(v).toMatchObject({ committable: true, nextAction: 'commit' });
		expect(lineView(l, plan(l), null).nextAction).toBe('approve');
	});
});
