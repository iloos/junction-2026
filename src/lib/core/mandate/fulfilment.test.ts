import { describe, expect, it } from 'vitest';
import type { Line, LineView, Need } from '../contracts';
import { fulfilmentOf, type FulfilmentFacts } from './fulfilment';

const need: Need = {
	id: 'need:tart',
	label: 'tarts',
	amount: { value: 8, unit: 'kg' },
	provenance: { source: 'team_estimate' }
};
const view = (ok: boolean): LineView => ({
	reviewable: ok,
	committable: false,
	knownStockCover: { value: 0, unit: 'pcs' },
	unknownStockCover: { value: 0, unit: 'pcs' },
	nextAction: ok ? 'approve' : 'resolve_rule'
});
const line = (id: string, qty: number, o: Partial<Line> = {}): Line =>
	({
		id,
		needId: need.id,
		productId: id,
		qty: { value: qty, unit: 'ST' },
		state: 'held',
		reasons: [],
		offer: { availability: { kind: 'known' } },
		lineCents: 100,
		provenance: { source: 'team_estimate' },
		...o
	}) as Line;
const mih = { strategy: { id: 'need:tart:mih', kind: 'make_in_house' as const } };
const facts = (receipts: Record<string, 'confirmed' | 'awaiting'> = {}): FulfilmentFacts => ({
	pack: () => ({ value: 1, unit: 'kg' }),
	// pastry: 1 unit serves 2 kg of dish; filling: 1 unit serves 4 kg.
	recipeUnit: (l) => (l.id === 'pastry' ? 2 : l.id === 'filling' ? 4 : undefined),
	receipt: (id) => receipts[id]
});

describe('fulfilment', () => {
	it('a recipe is AND: pastry without filling makes no tarts', () => {
		const lines = [line('pastry', 4, mih), line('filling', 2, mih)];
		const ok = fulfilmentOf(need, lines, new Map(lines.map((l) => [l.id, view(true)])), facts());
		expect(ok).toMatchObject({
			plannedKnown: { value: 8 },
			unresolved: { value: 0 },
			status: 'planned'
		});
		const noFilling = fulfilmentOf(
			need,
			lines,
			new Map([
				['pastry', view(true)],
				['filling', view(false)]
			]),
			facts()
		);
		expect(noFilling).toMatchObject({
			plannedKnown: { value: 0 },
			unresolved: { value: 8 },
			status: 'uncovered'
		});
	});

	it('a recipe is bounded by its scarcest ingredient and as sure as its least sure one', () => {
		const lines = [
			line('pastry', 2, mih),
			line('filling', 2, { ...mih, offer: { availability: { kind: 'unknown' } } as Line['offer'] })
		];
		const f = fulfilmentOf(need, lines, new Map(lines.map((l) => [l.id, view(true)])), facts());
		expect(f).toMatchObject({
			plannedUnknown: { value: 4 },
			unresolved: { value: 4 },
			status: 'partial'
		});
	});

	it('allocates by certainty up to the requirement; the rest is excess, never cover', () => {
		const lines = [
			line('known', 6),
			line('unknown', 6, { offer: { availability: { kind: 'unknown' } } as Line['offer'] })
		];
		const f = fulfilmentOf(need, lines, new Map(lines.map((l) => [l.id, view(true)])), facts());
		expect(f).toMatchObject({
			plannedKnown: { value: 6 },
			plannedUnknown: { value: 2 },
			excess: { value: 4 },
			unresolved: { value: 0 }
		});
	});

	it('committed lines are supplier-confirmed only when the receipt says so (partial receipts)', () => {
		const lines = [line('a', 5, { state: 'committed' }), line('b', 3, { state: 'committed' })];
		const f = fulfilmentOf(need, lines, new Map(), facts({ a: 'confirmed', b: 'awaiting' }));
		expect(f).toMatchObject({
			supplierConfirmed: { value: 5 },
			awaitingSupplier: { value: 3 },
			status: 'awaiting_supplier'
		});
	});
});
