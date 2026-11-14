/** The inline answers the key-less /request page accepts. No I/O. Its workspace comes from server/demo/visitor.ts. */
import type { RequestAnswer } from '$lib/ui/request/types';

const UNITS = new Set(['l', 'kg', 'pcs', 'case', 'sales']);

/** Inline answers from a request body; anything malformed is dropped, never trusted. */
export function readAnswers(raw: unknown): RequestAnswer[] {
	if (!Array.isArray(raw)) return [];
	const out: RequestAnswer[] = [];
	for (const a of raw.slice(0, 12)) {
		if (!a || typeof a !== 'object') continue;
		const { item, qty, unit, productId } = a as Record<string, unknown>;
		// Item ids are what the parser gives: product key or typed words, constraints, variant, "~n".
		if (typeof item !== 'string' || !/^[\p{L}\d._~-]{1,80}$/u.test(item)) continue;
		const ans: RequestAnswer = { item };
		if (
			typeof qty === 'number' &&
			qty > 0 &&
			qty <= 1e6 &&
			typeof unit === 'string' &&
			UNITS.has(unit)
		) {
			ans.qty = qty;
			ans.unit = unit as RequestAnswer['unit'];
		}
		if (typeof productId === 'string' && /^\d{6}$/.test(productId)) ans.productId = productId;
		if (ans.qty !== undefined || ans.productId) out.push(ans);
	}
	return out;
}
