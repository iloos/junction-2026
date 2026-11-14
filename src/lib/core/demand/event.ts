import type { Need } from '../contracts/plan';
import type { Measure, Provenance, SalesQty } from '../contracts/primitives';
import type { EventSeed, SeedDish } from './event-seed';
import { roundToSales } from './rounding';

export const EVENT_SEED_REF = 'fixtures/seeds/christmas-buffet-140.json';

/** A proposed order line before quoting: which need it serves, the product, and the rounded quantity. */
export interface DraftLine {
	needId: string;
	dish: string;
	productId: string;
	needAmount: Measure;
	qty: SalesQty;
}

export interface PlanEventOptions {
	/** Guest count to plan for; the seed's estimate when absent. */
	guests?: number;
	/** Grams served per guest, keyed by dish name or need id. */
	gServedOverrides?: Record<string, number>;
	provenance?: Provenance;
}

/**
 * Stable need id from a dish name: the part before " (" plus the part after ":" when present,
 * folded to ASCII. "Joulukinkku (Christmas ham)" → "need:joulukinkku";
 * "Riisipuuro (rice porridge): milk" → "need:riisipuuro-milk".
 */
export function needIdFor(dish: string): string {
	const [head, ...rest] = dish.split(':');
	const base = head.split(' (')[0];
	const suffix = rest.join(':').trim();
	const slug = [base, suffix]
		.filter(Boolean)
		.join(' ')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `need:${slug}`;
}

/** The dish family before ":"; entries sharing it are ingredients of one cooked dish. */
function familyOf(dish: string): string {
	return dish.split(':')[0].trim();
}

interface CookedDish {
	kg: number;
	perKg: Record<string, number>;
}

/** Litres for liquids, kg otherwise; drained basis when the pack is served drained. */
function needMeasure(value: number, d: SeedDish, unit: 'kg' | 'l'): Measure {
	const m: Measure = { value, unit };
	if (unit === 'kg' && d.pack?.drainedKg !== undefined) m.basis = 'drained';
	return m;
}

/**
 * Turn an event seed into needs and draft lines. Purchase need = guests × gServed ÷ yield. A dish
 * with `perKgDish` is cooked from ingredients: its gServed sizes the cooked dish, and a liquid entry
 * in the same family takes its amount from it (rice porridge → milk), so one edit moves both.
 * Quantities round up to the product's lot step or pack.
 */
export function planEventDemand(
	seed: EventSeed,
	opts: PlanEventOptions = {}
): { needs: Need[]; lines: DraftLine[] } {
	const guests = opts.guests ?? seed.guests.estimate;
	const overrides = opts.gServedOverrides ?? {};
	const provenance: Provenance = opts.provenance ?? {
		source: 'team_estimate',
		ref: EVENT_SEED_REF
	};

	const gServedOf = (d: SeedDish): number | undefined =>
		overrides[d.dish] ?? overrides[needIdFor(d.dish)] ?? d.gServed;

	const cooked = new Map<string, CookedDish>();
	for (const d of seed.dishes) {
		const g = gServedOf(d);
		if (d.perKgDish && g !== undefined)
			cooked.set(familyOf(d.dish), { kg: (guests * g) / 1000, perKg: d.perKgDish });
	}

	const needs: Need[] = [];
	const lines: DraftLine[] = [];
	for (const d of seed.dishes) {
		const amount = needAmountFor(d, guests, gServedOf(d), cooked.get(familyOf(d.dish)));
		const id = needIdFor(d.dish);
		needs.push({ id, label: d.dish, amount, provenance });
		lines.push({
			needId: id,
			dish: d.dish,
			productId: d.productId,
			needAmount: amount,
			qty: roundToSales(amount, { salesUnit: d.salesUnit, lotStep: d.lotStep, pack: d.pack })
		});
	}
	return { needs, lines };
}

function needAmountFor(
	d: SeedDish,
	guests: number,
	gServed: number | undefined,
	cooked: CookedDish | undefined
): Measure {
	const liquid = d.pack?.netL !== undefined;
	if (cooked) {
		// perKgDish keys end in their unit: the carrying entry buys the kg ingredient, a liquid sibling the litres.
		const key = Object.keys(cooked.perKg).find((k) =>
			liquid ? k.endsWith('L') : d.perKgDish !== undefined && k.endsWith('Kg')
		);
		if (key !== undefined)
			return needMeasure(clean(cooked.kg * cooked.perKg[key]), d, liquid ? 'l' : 'kg');
	}
	if (gServed === undefined) throw new Error(`dish "${d.dish}" has no gServed and no source dish`);
	const kg = (guests * gServed) / 1000 / (d.yield ?? 1);
	return needMeasure(clean(kg), d, liquid ? 'l' : 'kg');
}

/** Strip float noise (14 × 0.12 = 1.6800000000000002) while keeping real precision. */
function clean(x: number): number {
	return Math.round(x * 1e9) / 1e9;
}

/**
 * What each event line needs at the seed's own portions, in its sales unit, keyed by plan line id
 * (`${planId}-${needId}`). The yardstick for "check the quantity": a line far beyond it is a typo, not an order.
 */
export function seedNeedQty(
	planId: string,
	seed: EventSeed
): Map<string, { productId: string; value: number }> {
	return new Map(
		planEventDemand(seed).lines.map((l) => [
			`${planId}-${l.needId}`,
			{ productId: l.productId, value: l.qty.value }
		])
	);
}
