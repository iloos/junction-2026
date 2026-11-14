import { describe, expect, it } from 'vitest';
import { layoutFlow, OTHER, type FlowLink } from './flow';

const L = (k: string, p: string, cents: number, ordered = true): FlowLink => ({
	kitchenId: k,
	productId: p,
	cents,
	ordered
});
const names = { kitchen: (id: string) => id.toUpperCase(), product: (id: string) => `P ${id}` };

describe('flow layout', () => {
	it('sizes nodes by value and keeps each column within the height', () => {
		const f = layoutFlow([L('a', 'x', 300), L('b', 'x', 100), L('b', 'y', 100)], names, 200, 8, 10);
		expect(f.total).toBe(500);
		expect(f.left.map((n) => n.id)).toEqual(['a', 'b']);
		expect(f.right.map((n) => n.id)).toEqual(['x', 'y']);
		const bottom = (ns: { y: number; h: number }[]) => ns[ns.length - 1].y + ns[ns.length - 1].h;
		expect(bottom(f.left)).toBeCloseTo(200, 5);
		expect(bottom(f.right)).toBeCloseTo(200, 5);
		// Every band fits inside its two nodes.
		for (const b of f.bands) {
			const l = f.left.find((n) => n.id === b.from)!;
			const r = f.right.find((n) => n.id === b.to)!;
			expect(b.y0).toBeGreaterThanOrEqual(l.y - 1e-9);
			expect(b.y1).toBeLessThanOrEqual(l.y + l.h + 1e-9);
			expect(b.t0).toBeGreaterThanOrEqual(r.y - 1e-9);
			expect(b.t1).toBeLessThanOrEqual(r.y + r.h + 1e-9);
		}
	});

	it('folds products past the top N into Other products, kept last', () => {
		const links = ['p1', 'p2', 'p3', 'p4'].map((p, i) => L('a', p, 100 - i * 10));
		const f = layoutFlow(links, names, 100, 2);
		expect(f.right.map((n) => n.id)).toEqual(['p1', 'p2', OTHER]);
		expect(f.right[2]).toMatchObject({ label: 'Other products', cents: 150 });
	});

	it('keeps ordered and planned apart in the bands', () => {
		const f = layoutFlow([L('a', 'x', 100, true), L('a', 'x', 50, false)], names, 100);
		expect(f.bands.map((b) => b.ordered)).toEqual([true, false]);
	});

	it('handles nothing', () => {
		expect(layoutFlow([], names, 100)).toMatchObject({ left: [], right: [], bands: [], total: 0 });
	});
});
