/**
 * Turning an amount someone typed into the unit a need is measured in. Within a dimension the factors are fixed
 * (g → kg, dl → l). Between weight and volume only this product's own density counts: Valio's net weight and
 * content volume of the same pack (Product.netVolumePerSalesUnit). Never water, never a category guess. Without it
 * the answer is a question, and even with it the caller asks the chef to confirm before anything changes.
 */
import type { Measure, MeasureUnit, Product } from '../contracts';

/** Units a person may type; they reduce to the three a need is measured in. */
export type TypedUnit = 'g' | 'kg' | 'ml' | 'cl' | 'dl' | 'l' | 'pcs';

const BASE: Record<TypedUnit, [MeasureUnit, number]> = {
	g: ['kg', 0.001],
	kg: ['kg', 1],
	ml: ['l', 0.001],
	cl: ['l', 0.01],
	dl: ['l', 0.1],
	l: ['l', 1],
	pcs: ['pcs', 1]
};

const round = (n: number) => +n.toFixed(3);

/** A typed amount in its dimension's unit: 500 g → 0.5 kg, 5 dl → 0.5 l. Fixed factors only. */
export function toMeasure(value: number, unit: TypedUnit): Measure {
	const [to, factor] = BASE[unit];
	return { value: round(value * factor), unit: to };
}

/** This product's own kg per litre, from one pack's net weight and content volume; null when Valio lacks either. */
export function densityOf(p: Product | undefined): { kgPerL: number; note: string } | null {
	const w = p?.netPerSalesUnit?.value;
	const v = p?.netVolumePerSalesUnit?.value;
	if (!w || !v || w.unit !== 'kg' || !(v.value > 0)) return null;
	const kgPerL = w.value / v.value;
	return {
		kgPerL: round(kgPerL),
		note: `Valio lists ${w.value} kg per ${v.value} l pack (${round(kgPerL)} kg/l)`
	};
}

export type Conversion =
	| { ok: true; amount: Measure; via: 'fixed' | 'density'; note?: string }
	| { ok: false; reason: 'no_density' | 'pieces'; note: string };

/** `value unit` as `to`, or why it can't be converted. A density conversion carries its source for the question. */
export function convertAmount(
	value: number,
	unit: TypedUnit,
	to: MeasureUnit,
	p?: Product
): Conversion {
	const m = toMeasure(value, unit);
	if (m.unit === to) return { ok: true, amount: m, via: 'fixed' };
	if (m.unit === 'pcs' || to === 'pcs')
		return {
			ok: false,
			reason: 'pieces',
			note: `pieces and ${m.unit === 'pcs' ? to : m.unit} don't convert without a weight per piece`
		};
	const d = densityOf(p);
	if (!d)
		return {
			ok: false,
			reason: 'no_density',
			note: `${p?.nameFi ?? 'this product'} has no stated weight and volume to convert ${m.unit} to ${to}`
		};
	const amount = m.unit === 'kg' ? m.value / d.kgPerL : m.value * d.kgPerL;
	return { ok: true, amount: { value: round(amount), unit: to }, via: 'density', note: d.note };
}
