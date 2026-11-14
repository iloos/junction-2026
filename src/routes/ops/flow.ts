/**
 * Demand flow (Valio's view): which stores' money goes to which products, ordered and planned. A two-column
 * sankey laid out here, pure, so the SVG only draws. The top products by value get their own node; the rest
 * fold into "Other products".
 */
import type { WorkspaceState } from '$lib/core/state';

export interface FlowLink {
	kitchenId: string;
	productId: string;
	cents: number;
	ordered: boolean;
}

export interface FlowNode {
	id: string;
	label: string;
	cents: number;
	y: number;
	h: number;
}

export interface FlowBand {
	from: string;
	to: string;
	cents: number;
	ordered: boolean;
	/** Top and bottom of the band at each end. */
	y0: number;
	y1: number;
	t0: number;
	t1: number;
}

export const OTHER = '__other';

/** Money per (store, product): committed orders, and open plans' lines that will be ordered (not unorderable). */
export function flowLinks(s: WorkspaceState): FlowLink[] {
	const m = new Map<string, FlowLink>();
	const add = (kitchenId: string, productId: string, cents: number, ordered: boolean) => {
		if (!(cents > 0)) return;
		const k = `${kitchenId}|${productId}|${ordered}`;
		const l = m.get(k);
		if (l) l.cents += cents;
		else m.set(k, { kitchenId, productId, cents, ordered });
	};
	for (const o of Object.values(s.orders))
		for (const l of o.lines) add(o.kitchenId, l.productId, l.lineCents, true);
	for (const p of Object.values(s.plans)) {
		if (p.state === 'committed') continue;
		for (const l of p.lines)
			if (l.state === 'eligible' || l.state === 'held' || l.state === 'proposed')
				add(p.kitchenId, l.productId, l.lineCents ?? 0, false);
	}
	return [...m.values()];
}

/**
 * Lay out the sankey in a height of `height`, with `gap` between nodes. Products past `topN` by value fold into
 * one "Other products" node.
 */
export function layoutFlow(
	links: readonly FlowLink[],
	label: { kitchen: (id: string) => string; product: (id: string) => string },
	height: number,
	topN = 8,
	gap = 8
): { left: FlowNode[]; right: FlowNode[]; bands: FlowBand[]; total: number } {
	const byProduct = new Map<string, number>();
	for (const l of links) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.cents);
	const top = new Set(
		[...byProduct.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, topN)
			.map(([id]) => id)
	);
	const folded = links.map((l) => ({
		...l,
		productId: top.has(l.productId) ? l.productId : OTHER
	}));
	const sum = (key: 'kitchenId' | 'productId') => {
		const m = new Map<string, number>();
		for (const l of folded) m.set(l[key], (m.get(l[key]) ?? 0) + l.cents);
		return [...m.entries()].sort((a, b) =>
			a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1] - a[1] || a[0].localeCompare(b[0])
		);
	};
	const total = folded.reduce((n, l) => n + l.cents, 0);
	const place = (entries: [string, number][], name: (id: string) => string): FlowNode[] => {
		const usable = Math.max(1, height - gap * Math.max(0, entries.length - 1));
		let y = 0;
		return entries.map(([id, cents]) => {
			const h = total ? (cents / total) * usable : 0;
			const n = { id, label: name(id), cents, y, h };
			y += h + gap;
			return n;
		});
	};
	const left = place(sum('kitchenId'), label.kitchen);
	const right = place(sum('productId'), (id) =>
		id === OTHER ? 'Other products' : label.product(id)
	);
	const usableL = Math.max(1, height - gap * Math.max(0, left.length - 1));
	const usableR = Math.max(1, height - gap * Math.max(0, right.length - 1));
	// Stack bands inside each node in the other column's order, so they cross as little as possible.
	const rIndex = new Map(right.map((n, i) => [n.id, i]));
	const lIndex = new Map(left.map((n, i) => [n.id, i]));
	const lOff = new Map(left.map((n) => [n.id, n.y]));
	const rOff = new Map(right.map((n) => [n.id, n.y]));
	const merged = new Map<string, FlowLink>();
	for (const l of folded) {
		const k = `${l.kitchenId}|${l.productId}|${l.ordered}`;
		const m = merged.get(k);
		if (m) m.cents += l.cents;
		else merged.set(k, { ...l });
	}
	const sorted = [...merged.values()].sort(
		(a, b) =>
			lIndex.get(a.kitchenId)! - lIndex.get(b.kitchenId)! ||
			rIndex.get(a.productId)! - rIndex.get(b.productId)! ||
			Number(b.ordered) - Number(a.ordered)
	);
	const bands: FlowBand[] = [];
	for (const l of sorted) {
		const hl = total ? (l.cents / total) * usableL : 0;
		const y0 = lOff.get(l.kitchenId)!;
		lOff.set(l.kitchenId, y0 + hl);
		bands.push({
			from: l.kitchenId,
			to: l.productId,
			cents: l.cents,
			ordered: l.ordered,
			y0,
			y1: y0 + hl,
			t0: 0,
			t1: 0
		});
	}
	// Right ends in product order, then store order, so bands into one product stack top to bottom.
	for (const b of [...bands].sort(
		(a, c) =>
			rIndex.get(a.to)! - rIndex.get(c.to)! ||
			lIndex.get(a.from)! - lIndex.get(c.from)! ||
			Number(c.ordered) - Number(a.ordered)
	)) {
		const hr = total ? (b.cents / total) * usableR : 0;
		b.t0 = rOff.get(b.to)!;
		b.t1 = b.t0 + hr;
		rOff.set(b.to, b.t1);
	}
	return { left, right, bands, total };
}
