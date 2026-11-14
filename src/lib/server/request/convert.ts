/**
 * Request quantity → Valio sales units, using the product's pack hierarchy and its stated content.
 * Content comes from the product name ("1 l", "4x5 kg", "20 x … 500 g") or Valio's net weight, and
 * the two are cross-checked: when they disagree, or nothing says how much is in a unit, the
 * conversion is refused with the reason, and the chef is asked instead of being guessed for.
 */
import type { Product } from '$lib/core/contracts';
import type { ReqUnit } from './lexicon';

export {
	baseUnitsPerSales,
	contentPerSalesUnit,
	nameMeasures,
	type Content,
	type Dim
} from '$lib/core/demand/content';
import {
	baseUnitsPerSales,
	contentPerSalesUnit,
	type Content,
	type Dim
} from '$lib/core/demand/content';

export type Conversion =
	| {
			ok: true;
			salesQty: number;
			salesUnit: string;
			/** e.g. "1,000 l ÷ 1 l per ST = 1,000 ST (= 100 KI)". */
			explain: string;
			exact: boolean;
			perSalesUnit: Content | null;
			warnings: string[];
	  }
	| { ok: false; reason: string };

const fmt = (n: number, max = 3) =>
	new Intl.NumberFormat('en-IE', { maximumFractionDigits: max }).format(n);

/** The stated content of one sales unit: what the name says first, Valio net weight last. */
function bestContent(p: Product): Content | null {
	const all = (['kg', 'l'] as const)
		.map((d) => contentPerSalesUnit(p, d))
		.filter((c): c is Content => !('error' in c));
	return all.find((c) => c.source !== 'net') ?? all[0] ?? null;
}

const small = (v: number, dim: Dim) =>
	dim === 'kg' && v < 1
		? `${fmt(v * 1000)} g`
		: dim === 'l' && v < 1
			? `${fmt(v * 10)} dl`
			: `${fmt(v)} ${dim}`;

/**
 * N cases of a product, worked out once: how many sales units, what one case holds and what the
 * order comes to. The answer card's headline and the conversion line both read from this.
 */
export interface CaseBreakdown {
	cases: number;
	salesQty: number;
	salesUnit: string;
	salesPerCase: number;
	exact: boolean;
	/** Base units in one case and what each holds; null when the content is unknown. */
	perCase: { count: number; each: string; total: string } | null;
	/** What the whole order holds, e.g. "20 kg". */
	orderTotal: string | null;
}

export function caseBreakdown(p: Product, cases: number): CaseBreakdown | { error: string } {
	const su = p.salesUnit;
	const ki = p.packs.find((x) => x.unit === 'KI');
	const perSales = baseUnitsPerSales(p);
	if (su !== 'KI' && (!ki || !perSales))
		return { error: `this product has no case (KI) size; give the quantity in ${su}` };
	const salesPerCase = su === 'KI' ? 1 : ki!.baseUnits / perSales!;
	const raw = cases * salesPerCase;
	const salesQty = Math.ceil(raw - 1e-9);
	const c = bestContent(p);
	const count = ki?.baseUnits ?? null;
	const caseTotal = c ? c.value * salesPerCase : null;
	return {
		cases,
		salesQty,
		salesUnit: su,
		salesPerCase,
		exact: Math.abs(salesQty - raw) < 1e-6,
		perCase:
			c && caseTotal !== null && count
				? {
						count,
						each: small(caseTotal / count, c.unit),
						total: small(caseTotal, c.unit)
					}
				: null,
		orderTotal: c ? small(c.value * salesQty, c.unit) : null
	};
}

/** "2 × (20 × 500 g) = 20 kg": the headline of a case answer card. */
export function caseHeadline(b: CaseBreakdown): string {
	if (!b.perCase) return `${fmt(b.cases)} cases, size not stated`;
	const one = b.perCase.count > 1 ? `${fmt(b.perCase.count)} × ${b.perCase.each}` : b.perCase.total;
	return `${fmt(b.cases)} × (${one}) = ${b.orderTotal}`;
}

/** What one case (KI) holds, e.g. "20 × 200 g = 4 kg". */
export function caseDescription(p: Product): string | null {
	const b = caseBreakdown(p, 1);
	if ('error' in b || !b.perCase) return null;
	return b.perCase.count > 1
		? `${fmt(b.perCase.count)} × ${b.perCase.each} = ${b.perCase.total}`
		: `${b.perCase.total} per case`;
}

/** "(= 100 KI)" when the product has a case level and the quantity fills whole cases. */
function caseNote(p: Product, salesQty: number): string {
	if (p.salesUnit === 'KI') return '';
	const ki = p.packs.find((x) => x.unit === 'KI');
	const perSales = baseUnitsPerSales(p);
	if (!ki || !perSales) return '';
	const cases = (salesQty * perSales) / ki.baseUnits;
	return Number.isInteger(+cases.toFixed(6)) ? ` (= ${fmt(cases)} KI)` : ` (≈ ${fmt(cases, 1)} KI)`;
}

/** Converts a request quantity into the product's sales units. Rounds up to whole sales units and says so. */
export function convert(qty: number, unit: ReqUnit, p: Product): Conversion {
	const su = p.salesUnit;
	const warnings: string[] = [];
	if (unit === 'sales')
		return {
			ok: true,
			salesQty: qty,
			salesUnit: su,
			explain: `${fmt(qty)} ${su} as asked${caseNote(p, qty)}`,
			exact: true,
			perSalesUnit: null,
			warnings: [`no unit in the request: read as ${su}, the product's sales unit`]
		};

	if (unit === 'case') {
		const b = caseBreakdown(p, qty);
		if ('error' in b) return { ok: false, reason: b.error };
		warnings.push(
			b.orderTotal
				? `case sizes differ between products: this order is ${b.orderTotal}`
				: 'case sizes differ between products, and this one does not state its content'
		);
		const explain =
			su === 'KI'
				? `${fmt(qty)} cases = ${fmt(b.salesQty)} KI`
				: `${fmt(qty)} KI × ${fmt(b.salesPerCase)} ${su} per KI = ${fmt(b.salesQty)} ${su}`;
		return {
			ok: true,
			salesQty: b.salesQty,
			salesUnit: su,
			explain: explain + (b.orderTotal ? ` (= ${b.orderTotal})` : ''),
			exact: b.exact,
			perSalesUnit: null,
			warnings
		};
	}

	if (unit === 'pcs') {
		const perSales = baseUnitsPerSales(p);
		if (perSales === 1 && ['ST', 'KPL', 'PCE', 'RAS', 'PAK', 'PRK', 'PSS', 'BAG'].includes(su))
			return {
				ok: true,
				salesQty: qty,
				salesUnit: su,
				explain: `${fmt(qty)} pcs = ${fmt(qty)} ${su}${caseNote(p, qty)}`,
				exact: true,
				perSalesUnit: null,
				warnings
			};
		if (perSales && perSales > 1) {
			const salesQty = Math.ceil(qty / perSales - 1e-9);
			return {
				ok: true,
				salesQty,
				salesUnit: su,
				explain: `${fmt(qty)} ${p.baseUnit} ÷ ${fmt(perSales)} per ${su} = ${fmt(salesQty)} ${su}${salesQty * perSales !== qty ? ` (rounded up from ${fmt(qty / perSales, 2)})` : ''}`,
				exact: salesQty * perSales === qty,
				perSalesUnit: null,
				warnings
			};
		}
		return {
			ok: false,
			reason: `can't tell what one piece is for ${su}; give the quantity in ${su}`
		};
	}

	const c = contentPerSalesUnit(p, unit);
	if ('error' in c) return { ok: false, reason: `${c.error}; give the quantity in ${su}` };
	const raw = qty / c.value;
	const salesQty = Math.ceil(raw - 1e-9);
	const exact = Math.abs(salesQty - raw) < 1e-6;
	if (c.source === 'sold_by_kg')
		return {
			ok: true,
			salesQty: qty,
			salesUnit: su,
			explain: `${fmt(qty)} kg, sold per kg`,
			exact: true,
			perSalesUnit: c,
			warnings
		};
	const explain =
		`${fmt(qty)} ${unit} ÷ ${fmt(c.value)} ${unit} per ${su} = ${fmt(salesQty)} ${su}` +
		(exact ? '' : ` (rounded up from ${fmt(raw, 2)})`) +
		caseNote(p, salesQty);
	if (c.source === 'net') warnings.push(`content from Valio's net weight, not the name`);
	return { ok: true, salesQty, salesUnit: su, explain, exact, perSalesUnit: c, warnings };
}

/** What `salesQty` sales units hold in total (kg or l), when the product states it. */
export function orderAmount(p: Product, salesQty: number): { value: number; unit: Dim } | null {
	const c = bestContent(p);
	return c ? { value: +(c.value * salesQty).toFixed(6), unit: c.unit } : null;
}
