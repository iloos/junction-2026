/**
 * Sizing a replacement for a dish: how much of another product, or of each make-in-house ingredient, serves the
 * same need. One place for it, used when a substitute is ranked and whenever the dish's need changes.
 */
import type { Line, Measure, MeasureUnit, Product, SalesQty } from '../contracts';
import type { EventSeed } from './event-seed';
import { roundToSales } from './rounding';

/* eslint-disable @typescript-eslint/no-explicit-any -- seed candidate/rescue entries are loose JSON */
type Loose = any;

export interface PoolEntry {
	productId: string;
	fromValioRule: boolean;
	yield?: number;
	pack?: Loose;
}

/** The seed's hand-checked rescue entry for a planned product ("whole-ham-462490" → 462490). */
export function rescueFor(seed: EventSeed | undefined, productId: string): Loose | undefined {
	const rescue = (seed as Loose)?.rescue;
	if (!rescue) return undefined;
	const key = Object.keys(rescue).find((k) => k.endsWith(`-${productId}`));
	return key ? rescue[key] : undefined;
}

/** Sales quantity of a candidate that serves `servedKg` (or the original line's quantity for direct orders). */
export function sizeFor(
	p: Product,
	entry: PoolEntry,
	servedKg: number | null,
	line: Line
): { qty: Line['qty'] } | null {
	if (servedKg === null) return p.salesUnit === line.qty.unit ? { qty: line.qty } : null;
	const kg = servedKg / (entry.yield ?? 1);
	const pack =
		entry.pack ??
		(p.netPerSalesUnit?.value.unit === 'kg' && !p.catchWeight
			? { netKg: p.netPerSalesUnit.value.value }
			: undefined);
	if (!p.catchWeight && !pack) return null; // cannot size without a pack weight
	return {
		qty: roundToSales(
			{ value: +kg.toFixed(4), unit: 'kg' },
			{ salesUnit: p.salesUnit, lotStep: p.catchWeight ? p.lotStep : undefined, pack }
		)
	};
}

/** The pool entry the seed gives for a product serving this dish (yield and pack as hand-checked). */
export function seedEntryFor(
	seed: EventSeed | undefined,
	needLabel: string,
	plannedProductId: string,
	productId: string
): PoolEntry {
	const dish = seed?.dishes.find((d) => d.dish === needLabel) as Loose;
	const rescue = rescueFor(seed, plannedProductId);
	const fromSeed = [
		...((dish?.candidates ?? []) as Loose[]),
		...((rescue?.alternatives ?? []) as Loose[]),
		...(rescue?.chosen?.productId ? [rescue.chosen] : [])
	].find((c) => c.productId === productId);
	return {
		productId,
		fromValioRule: false,
		yield: fromSeed ? (fromSeed.yield ?? (rescue ? 1 : dish?.yield)) : dish?.yield,
		pack: fromSeed?.pack
	};
}

/**
 * Sales quantity of one make-in-house ingredient for a need of `needKg` of the dish: `per` is the ingredient amount
 * per kg of need and `pack` its amount per sales unit (seed, team estimate). KG-sold ingredients round up to 0.01;
 * pack-sold ones to whole units. Falls back to the seed's fixed order when the ingredient has no `per`.
 */
export function makeInHouseQty(ingredient: Loose, needKg: number): Line['qty'] {
	const unit: string = ingredient.order?.unit ?? ingredient.salesUnit;
	if (needKg <= 0) return { value: 0, unit, rounding: 'dish need is 0: nothing to buy' };
	if (!ingredient.per || !ingredient.pack)
		return { value: ingredient.order.qty, unit, rounding: ingredient.need };
	const amount = needKg * ingredient.per;
	const raw = amount / ingredient.pack;
	const value =
		unit === 'KG' ? Math.ceil(raw * 100 - 1e-9) / 100 : Math.max(1, Math.ceil(raw - 1e-9));
	const basis = ingredient.perUnit ?? 'kg';
	return {
		value,
		unit,
		rounding: `${needKg.toFixed(2)} kg dish × ${ingredient.per} ${basis}/kg = ${amount.toFixed(2)} ${basis} → ${value} ${unit}`
	};
}

const PRINTED: Record<'kg' | 'l', { re: RegExp; factor: Record<string, number> }> = {
	l: { re: /(\d+(?:[.,]\d+)?)\s*(l|dl|cl|ml)\b/i, factor: { l: 1, dl: 0.1, cl: 0.01, ml: 0.001 } },
	kg: { re: /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i, factor: { kg: 1, g: 0.001 } }
};

/**
 * Physical content of one sales unit in `unit`, when the catalogue states it: the net content when it is in that unit,
 * else the amount printed in the name ("1 l", "5 dl", "200 g") per base unit × base units per sales unit (a KI of
 * 20 × 200 g butter is 4 kg; of 5 × 1 l juice, 5 l). Null when unknown: content is never guessed.
 */
export function contentPerSalesUnit(p: Product, unit: MeasureUnit): number | null {
	const net = p.netPerSalesUnit?.value;
	if (net && net.unit === unit) return net.value;
	if (unit === 'pcs') return null;
	const printed = PRINTED[unit];
	const m = (p.nameFi ?? '').match(printed.re);
	if (!m) return null;
	const perBase = Number(m[1].replace(',', '.')) * printed.factor[m[2].toLowerCase()];
	const base = p.packs.find((x) => x.unit === p.salesUnit)?.baseUnits ?? 1;
	return perBase > 0 ? +(perBase * base).toFixed(4) : null;
}

/**
 * Sales quantity of a product that delivers a physical amount someone asked for (a `direct` need: "1 l milk"):
 * KG-sold products by weight, others by their content per sales unit, rounded up to whole lots. Null when the
 * product's content in that unit is unknown: it can't be sized, never guessed.
 */
export function sizeDirect(p: Product, amount: Measure): SalesQty | null {
	const lots = (units: number) => {
		const step = p.lotStep > 0.01 ? p.lotStep : p.salesUnit === 'KG' ? 0.01 : 1;
		return +(Math.ceil(units / step - 1e-9) * step).toFixed(3);
	};
	if (amount.value <= 0) return { value: 0, unit: p.salesUnit, rounding: 'nothing asked for' };
	if (p.salesUnit === 'KG') {
		if (amount.unit !== 'kg') return null;
		const value = lots(amount.value);
		return { value, unit: 'KG', rounding: `${amount.value} kg → ${value} KG` };
	}
	const content = contentPerSalesUnit(p, amount.unit);
	if (!content) return null;
	const value = lots(amount.value / content);
	return {
		value,
		unit: p.salesUnit,
		rounding: `${amount.value} ${amount.unit} / ${content} ${amount.unit} → ${value} ${p.salesUnit} (${+(value * content).toFixed(3)} ${amount.unit})`
	};
}
