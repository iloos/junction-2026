/**
 * Request quantity → Valio sales units, using the product's pack hierarchy and its stated content.
 * Content comes from the product name ("1 l", "4x5 kg", "20 x … 500 g") or Valio's net weight, and
 * the two are cross-checked: when they disagree, or nothing says how much is in a unit, the
 * conversion is refused with the reason, and the chef is asked instead of being guessed for.
 */
import type { Product } from '$lib/core/contracts';
import type { ReqUnit } from './lexicon';

export type Dim = 'l' | 'kg';

export interface Content {
	value: number;
	unit: Dim;
	/** Where the number came from, shown to the chef. */
	source: 'name' | 'net' | 'sold_by_kg';
	text: string;
}

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

const VOLUME: Record<string, number> = { l: 1, dl: 0.1, cl: 0.01, ml: 0.001 };
const MASS: Record<string, number> = { kg: 1, g: 0.001 };

const fmt = (n: number, max = 3) =>
	new Intl.NumberFormat('en-IE', { maximumFractionDigits: max }).format(n);

interface NameMeasure {
	value: number;
	dim: Dim;
	/** "4x5 kg" → 4 */
	times: number | null;
	raw: string;
	approx: boolean;
}

/** Measures in a product name: "1 l", "0,5 l", "5 dl", "4x5 kg", "100x2 cl", "N.700G". */
export function nameMeasures(name: string): NameMeasure[] {
	const out: NameMeasure[] = [];
	const re = /(n\.\s*)?(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)(?![\p{L}])/giu;
	for (const m of name.matchAll(re)) {
		const unit = m[4].toLowerCase();
		const n = Number(m[3].replace(',', '.'));
		const dim: Dim = unit in VOLUME ? 'l' : 'kg';
		const factor = dim === 'l' ? VOLUME[unit] : MASS[unit];
		out.push({
			value: +(n * factor).toFixed(6),
			dim,
			times: m[2] ? Number(m[2]) : null,
			raw: m[0].trim(),
			approx: Boolean(m[1])
		});
	}
	return out;
}

/** "20 x Arla … 500 g": a leading multiplier means the sales unit holds that many base units. */
function leadingTimes(name: string): number | null {
	const m = name.match(/^\s*(\d+)\s*[x×]\s+\D/);
	return m ? Number(m[1]) : null;
}

/** Base units in one sales unit (KI = 10 ST → 10). Null when the hierarchy does not say. */
export function baseUnitsPerSales(p: Product): number | null {
	if (p.salesUnit === p.baseUnit) return 1;
	return p.packs.find((x) => x.unit === p.salesUnit)?.baseUnits ?? null;
}

/** How much of `dim` one sales unit holds, or why that is unknown. */
export function contentPerSalesUnit(p: Product, dim: Dim): Content | { error: string } {
	if (dim === 'kg' && p.salesUnit === 'KG')
		return { value: 1, unit: 'kg', source: 'sold_by_kg', text: 'sold per kg' };

	const perSales = baseUnitsPerSales(p);
	const net =
		p.netPerSalesUnit && p.netPerSalesUnit.value.unit === dim
			? p.netPerSalesUnit.value.value
			: null;
	const ms = nameMeasures(p.nameFi).filter((m) => m.dim === dim);
	const distinct = [...new Set(ms.map((m) => `${m.times ?? 1}x${m.value}`))];

	if (distinct.length > 1)
		return {
			error: `the name states more than one ${dim === 'l' ? 'volume' : 'weight'} (${ms.map((m) => m.raw).join(', ')})`
		};

	if (ms.length === 1) {
		const m = ms[0];
		if (m.approx) return { error: `the name gives an approximate weight (${m.raw})` };
		const lead = leadingTimes(p.nameFi);
		// Possible readings of the name as content per sales unit.
		const readings: { value: number; why: string }[] = [];
		if (m.times !== null) {
			if (perSales !== null && perSales === m.times && perSales !== 1)
				readings.push({
					value: m.value * m.times,
					why: `${p.salesUnit} = ${m.times} × ${fmt(m.value)} ${dim}`
				});
			else if (perSales === 1) {
				readings.push({ value: m.value * m.times, why: `one ${p.salesUnit} = ${m.raw}` });
				readings.push({ value: m.value, why: `one ${p.salesUnit} = ${fmt(m.value)} ${dim}` });
			}
		} else if (lead !== null && perSales !== null && (perSales === lead || perSales === 1)) {
			readings.push({
				value: m.value * lead,
				why: `${p.salesUnit} = ${lead} × ${fmt(m.value)} ${dim}`
			});
		} else if (perSales !== null) {
			readings.push({
				value: m.value * perSales,
				why:
					perSales === 1
						? `one ${p.salesUnit} = ${m.raw}`
						: `${p.salesUnit} = ${perSales} × ${m.raw}`
			});
		}
		if (readings.length === 0)
			return {
				error: `the pack hierarchy does not say how many ${p.baseUnit} are in one ${p.salesUnit}`
			};
		// Cross-check with Valio's net weight when there is one; it decides between two readings.
		if (net !== null) {
			const match = readings.find((r) => Math.abs(r.value - net) / net <= 0.1);
			if (!match)
				return {
					error: `the name says ${readings.map((r) => `${fmt(r.value)} ${dim}`).join(' or ')} per ${p.salesUnit} but Valio's net weight says ${fmt(net)} ${dim}`
				};
			return {
				value: +match.value.toFixed(6),
				unit: dim,
				source: 'name',
				text: `${match.why} (name, matches Valio net weight)`
			};
		}
		if (readings.length > 1)
			return {
				error: `"${m.raw}" could mean ${readings.map((r) => `${fmt(r.value)} ${dim}`).join(' or ')} per ${p.salesUnit}`
			};
		return {
			value: +readings[0].value.toFixed(6),
			unit: dim,
			source: 'name',
			text: `${readings[0].why} (from the name)`
		};
	}

	if (net !== null)
		return {
			value: net,
			unit: dim,
			source: 'net',
			text: `Valio net weight ${fmt(net)} ${dim} per ${p.salesUnit}`
		};
	return {
		error: `neither the name nor Valio's data says how much ${dim === 'l' ? 'volume' : 'weight'} is in one ${p.salesUnit}`
	};
}

/** The stated content of one sales unit: what the name says first, Valio net weight last. */
function bestContent(p: Product): Content | null {
	const all = (['kg', 'l'] as const)
		.map((d) => contentPerSalesUnit(p, d))
		.filter((c): c is Content => !('error' in c));
	return all.find((c) => c.source !== 'net') ?? all[0] ?? null;
}

/** "40 kg" / "20 l" for a number of sales units, when the content is known. */
function totalContent(p: Product, salesQty: number): string | null {
	const c = bestContent(p);
	return c ? `${fmt(salesQty * c.value)} ${c.unit}` : null;
}

const small = (v: number, dim: Dim) =>
	dim === 'kg' && v < 1
		? `${fmt(v * 1000)} g`
		: dim === 'l' && v < 1
			? `${fmt(v * 10)} dl`
			: `${fmt(v)} ${dim}`;

/** What one case (KI) holds, e.g. "20 × 200 g = 4 kg", or null when Valio's data doesn't say. */
export function caseDescription(p: Product): string | null {
	const ki = p.packs.find((x) => x.unit === 'KI');
	const perSales = baseUnitsPerSales(p);
	if (!ki || !perSales) return null;
	const salesPerCase = p.salesUnit === 'KI' ? 1 : ki.baseUnits / perSales;
	const c = bestContent(p);
	if (!c) return null;
	const total = c.value * salesPerCase;
	const per = total / ki.baseUnits;
	return ki.baseUnits > 1
		? `${fmt(ki.baseUnits)} × ${small(per, c.unit)} = ${small(total, c.unit)}`
		: `${small(total, c.unit)} per case`;
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
		const caseWarn = (salesQty: number) => {
			const held = totalContent(p, salesQty);
			warnings.push(
				held
					? `case sizes differ between products: this order is ${held}`
					: `case sizes differ between products, and this one does not state its content`
			);
			return held ? ` (= ${held})` : '';
		};
		if (su === 'KI')
			return {
				ok: true,
				salesQty: qty,
				salesUnit: su,
				explain: `${fmt(qty)} cases = ${fmt(qty)} KI${caseWarn(qty)}`,
				exact: true,
				perSalesUnit: null,
				warnings
			};
		const ki = p.packs.find((x) => x.unit === 'KI');
		const perSales = baseUnitsPerSales(p);
		if (!ki || !perSales)
			return {
				ok: false,
				reason: `this product has no case (KI) size; give the quantity in ${su}`
			};
		const raw = (qty * ki.baseUnits) / perSales;
		const salesQty = Math.ceil(raw - 1e-9);
		return {
			ok: true,
			salesQty,
			salesUnit: su,
			explain: `${fmt(qty)} KI × ${fmt(ki.baseUnits / perSales)} ${su} per KI = ${fmt(salesQty)} ${su}${caseWarn(salesQty)}`,
			exact: salesQty === +raw.toFixed(6),
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
