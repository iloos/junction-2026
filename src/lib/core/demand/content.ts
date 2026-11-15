/**
 * How much one sales unit holds, in kg or l: from the product name ("1 l", "4x5 kg", "20 x … 500 g") or Valio's
 * net weight, cross-checked against the pack hierarchy. When they disagree, or nothing says, the answer is an error
 * with the reason: content is never guessed. The one implementation; request conversion, direct sizing and the
 * line views all read it.
 */
import type { Product } from '../contracts';

export type Dim = 'l' | 'kg';

export interface Content {
	value: number;
	unit: Dim;
	/** Where the number came from, shown to the chef. */
	source: 'name' | 'net' | 'sold_by_kg';
	text: string;
}

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

/** "JÄÄSALAATTI 100G SUOMI 12KPL": a trailing piece count means the sales unit holds that many of the stated size. */
function trailingCount(name: string, after = ''): number | null {
	// Only a count after the stated size ("100G … 12KPL"); "30kpl 1,8kg" gives the total, not the piece.
	const at = after ? name.toLowerCase().indexOf(after.toLowerCase()) : -1;
	const m = (at >= 0 ? name.slice(at + after.length) : name).match(
		/(\d+)\s*(?:kpl|st|pcs)(?![\p{L}])/iu
	);
	const n = m ? Number(m[1]) : null;
	return n && n > 1 ? n : null;
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
		const ki = p.packs.find((x) => x.unit === 'KI');
		if (
			m.times !== null &&
			ki &&
			ki.baseUnits === m.times &&
			m.times > 1 &&
			perSales !== null &&
			perSales !== m.times
		) {
			// "4x5 kg" with a KI of 4: the name describes the case, so one ${p.baseUnit} is 5 kg.
			const value = +(m.value * perSales).toFixed(6);
			const why = `KI = ${m.times} × ${fmt(m.value)} ${dim}, so one ${p.salesUnit} = ${fmt(value)} ${dim}`;
			const close = (a: number, b: number) => Math.abs(a - b) / b <= 0.1;
			if (net === null || close(net, value))
				return { value, unit: dim, source: 'name', text: `${why} (from the name)` };
			if (close(net, m.value * m.times))
				return {
					value,
					unit: dim,
					source: 'name',
					text: `${why}; Valio's net weight (${fmt(net)} ${dim}) is the whole case`
				};
			return {
				error: `the name says ${fmt(value)} ${dim} per ${p.salesUnit} but Valio's net weight says ${fmt(net)} ${dim}`
			};
		}
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
		} else if (
			trailingCount(p.nameFi, m.raw) !== null &&
			perSales !== null &&
			(perSales === 1 || perSales === trailingCount(p.nameFi, m.raw))
		) {
			const n = trailingCount(p.nameFi, m.raw)!;
			readings.push({ value: m.value * n, why: `${p.salesUnit} = ${n} × ${fmt(m.value)} ${dim}` });
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
