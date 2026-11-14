/**
 * The ProductToken's card loader: one read per product and delivery date per page, through the keyless kitchen
 * helper. Offline (/offline) there is no server, so the card shows only what the page already knows.
 */
import type { ProductCard } from '$lib/server/products/card';

export type { ProductCard };

const cards = new Map<string, Promise<ProductCard>>();

export function loadCard(productId: string, deliverBy?: string): Promise<ProductCard> {
	const key = `${productId}@${deliverBy ?? ''}`;
	let p = cards.get(key);
	if (!p) {
		p = fetch(
			`/kitchen-api/product/${encodeURIComponent(productId)}${deliverBy ? `?deliverBy=${deliverBy}` : ''}`
		).then(async (r) => {
			const b = await r.json().catch(() => null);
			if (!r.ok || !b || b.error) throw new Error(b?.error?.message ?? `HTTP ${r.status}`);
			return b as ProductCard;
		});
		cards.set(key, p);
		p.catch(() => cards.delete(key));
	}
	return p;
}

/** "10 × 1 l", "2.38 kg", "1 × 1.5 kg": count of sales units times pack, or a weight as it is bought. */
export function qtyText(
	q: { count: number; pack?: string } | { amount: number; unit: string }
): string {
	const n = (v: number) =>
		Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
	if ('count' in q) return q.pack ? `${n(q.count)} × ${q.pack}` : n(q.count);
	return `${n(q.amount)} ${q.unit}`;
}
