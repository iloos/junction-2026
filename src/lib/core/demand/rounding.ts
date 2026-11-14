import type { Measure, SalesQty } from '../contracts/primitives';
import type { SeedPack } from './event-seed';

/** Absorbs float noise before ceil, so 5.6 / 0.7 = 8.000000000000002 rounds to 8, not 9. */
const EPS = 1e-9;

export function ceilSafe(x: number): number {
	return Math.ceil(x - EPS);
}

/** Round a quantity up to whole lots of `step`: the one lot rounding (needs, direct amounts, typed quantities). */
export function roundToLots(x: number, step: number): { lots: number; value: number } {
	const lots = Math.max(0, ceilSafe(x / step));
	return { lots, value: +(lots * step).toFixed(3) };
}

/** What a product is sold as: its sales unit, and either a catch-weight lot step or a pack. */
export interface SalesSpec {
	salesUnit: string;
	/** Catch-weight lot step in sales units (KG); the need rounds up to a multiple of it. */
	lotStep?: number;
	pack?: SeedPack;
}

/** 27 → "27.0", 11.529 → "11.53", 5.6 → "5.6": at most two decimals, at least one. */
export function fmtAmount(x: number): string {
	const s = String(Math.round(x * 100) / 100);
	return s.includes('.') ? s : `${s}.0`;
}

/** Ratio with up to two decimals and no forced ".0": 8, 2.33, 5.04. */
function fmtRatio(x: number): string {
	return String(Math.round(x * 100) / 100);
}

/**
 * Round a need up to whole sales units. Catch-weight KG items round the kg need up to a multiple of
 * the lot step; pack items round up by the pack's usable content (drained before net for buckets
 * served drained, litres for liquids, pieces when the pack counts pieces).
 */
export function roundToSales(need: Measure, spec: SalesSpec): SalesQty {
	const unit = spec.salesUnit;
	const v = need.value;

	if (spec.lotStep !== undefined && !spec.pack) {
		if (need.unit !== 'kg') throw new Error(`lot-step rounding needs kg, got ${need.unit}`);
		const { lots, value: qty } = roundToLots(v, spec.lotStep);
		return {
			value: qty,
			unit,
			rounding: `${fmtAmount(v)} kg → ${lots} × ${spec.lotStep} kg lot = ${qty} kg`
		};
	}

	const pack = spec.pack;
	if (!pack) throw new Error(`no lot step or pack for sales unit ${unit}`);

	if (pack.pieces !== undefined && (need.unit === 'pcs' || pack.netKg !== undefined)) {
		const pcs = need.unit === 'pcs' ? v : piecesFromKg(need, pack);
		const n = Math.max(0, ceilSafe(pcs / pack.pieces));
		return {
			value: n,
			unit,
			rounding: `${fmtRatio(pcs)} pcs / ${pack.pieces} → ${n} ${unit} (${n * pack.pieces} pcs)`
		};
	}

	const content = contentFor(need, pack);
	const ratio = v / content.amount;
	const n = Math.max(0, ceilSafe(ratio));
	const label = need.unit === 'l' ? 'l' : need.basis === 'drained' ? 'kg drained' : 'kg';
	const exact = Math.abs(ratio - n) < EPS * Math.max(1, n);
	const rounding = exact
		? `${fmtRatio(v)} ${label} / ${content.amount} = ${n} ${unit}`
		: `${fmtRatio(v)} ${label} / ${content.amount} = ${fmtRatio(ratio)} → ${n} ${unit}`;
	return { value: n, unit, rounding };
}

function piecesFromKg(need: Measure, pack: SeedPack): number {
	if (need.unit !== 'kg' || pack.netKg === undefined || pack.pieces === undefined)
		throw new Error('pieces need a kg need and a pack with pieces and netKg');
	// Round the piece count to absorb float noise (8.4 / 0.06 = 140.00000000000003).
	return Math.round((need.value / (pack.netKg / pack.pieces)) * 1e6) / 1e6;
}

function contentFor(need: Measure, pack: SeedPack): { amount: number } {
	if (need.unit === 'l') {
		if (pack.netL === undefined) throw new Error('litre need on a pack without netL');
		return { amount: pack.netL };
	}
	if (need.unit === 'kg') {
		if (need.basis === 'drained' && pack.drainedKg !== undefined) return { amount: pack.drainedKg };
		const kg = pack.drainedKg ?? pack.netKg;
		if (kg === undefined) throw new Error('kg need on a pack without netKg or drainedKg');
		return { amount: kg };
	}
	throw new Error(`cannot round a ${need.unit} need against this pack`);
}
