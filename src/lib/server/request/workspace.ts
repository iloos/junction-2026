/** The inline answers the key-less /request page accepts. No I/O. Its workspace comes from server/demo/visitor.ts. */
import type { ReqUnit } from './lexicon';
import type { ParsedItem } from './parse';
import { buildSearch, slug } from './parse';
import { BRANDS, CONSTRAINTS, type ConstraintKey } from './lexicon';

/** The chef's inline answer to a question, by item id: a quantity, a product, or both. */
export interface RequestAnswer {
	item: string;
	qty?: number;
	unit?: ReqUnit;
	productId?: string;
	/** Why the product is pinned, when the server pinned it (a dish line); never read from a request body. */
	why?: string;
}

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

/** The dish choice from a request body: option, edited portions, or "packs, not portions". */
export function readDish(
	raw: unknown
): { option?: 'ready' | 'raw'; portions?: number; packs?: boolean } | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const { option, portions, packs } = raw as Record<string, unknown>;
	const out: { option?: 'ready' | 'raw'; portions?: number; packs?: boolean } = {};
	if (option === 'ready' || option === 'raw') out.option = option;
	if (typeof portions === 'number' && Number.isInteger(portions) && portions > 0 && portions <= 1e6)
		out.portions = portions;
	if (packs === true) out.packs = true;
	return Object.keys(out).length ? out : undefined;
}

const KEYS = new Set<string>(CONSTRAINTS.map((c) => c.key));

/**
 * Items the chef edited in place (quantity, unit, words). Only the editable fields are read; searches are rebuilt
 * from the words, never taken from the body.
 */
export function readItems(raw: unknown): ParsedItem[] | undefined {
	if (!Array.isArray(raw) || !raw.length) return undefined;
	const out: ParsedItem[] = [];
	for (const a of raw.slice(0, 12)) {
		if (!a || typeof a !== 'object') continue;
		const r = a as Record<string, unknown>;
		const query = typeof r.query === 'string' ? r.query.trim().slice(0, 80) : '';
		if (!query) continue;
		const qty = typeof r.qty === 'number' && r.qty > 0 && r.qty <= 1e6 ? r.qty : null;
		const unit =
			typeof r.unit === 'string' && UNITS.has(r.unit) ? (r.unit as ReqUnit) : qty ? 'sales' : null;
		const constraints = (Array.isArray(r.constraints) ? r.constraints : []).filter(
			(c): c is ConstraintKey => typeof c === 'string' && KEYS.has(c)
		);
		const product =
			typeof r.product === 'string' && /^[a-z]{2,20}$/.test(r.product) ? r.product : null;
		const search =
			Array.isArray(r.search) && r.search.every((x) => typeof x === 'string') && r.search.length
				? buildSearch(String(r.search.at(-1)).slice(0, 60), constraints)
				: buildSearch(query, constraints);
		const id = typeof r.id === 'string' && /^[\p{L}\d._~-]{1,80}$/u.test(r.id) ? r.id : slug(query);
		const brand =
			typeof r.brand === 'string'
				? BRANDS.find((b) => b.toLowerCase() === (r.brand as string).toLowerCase())
				: undefined;
		out.push({
			...(brand ? { brand } : {}),
			id,
			text: query,
			query,
			product,
			search,
			qty,
			unit,
			constraints,
			variant: null,
			ambiguities: []
		});
	}
	return out.length ? out : undefined;
}
