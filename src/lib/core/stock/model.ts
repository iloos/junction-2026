/**
 * The stock model (D27): per product and delivery day, how much Valio will have, and why.
 *
 * Starts from Valio's own answer (the availability a plan already fetched: never a bulk fetch), then each day:
 * the rest of Valio's customers draw stock (a weekday curve by kitchen type, a festive bump), this workspace's
 * committed orders drain it on their delivery day, restock arrives on the product's rhythm (warehouse items on
 * restock days, supplier items every cycle) and sometimes arrives short (Valio's delivery reliability), and scenario
 * events shift it (a shortage). Regular parts come from ESTIMATES, each labelled with its source; noise around them
 * is seeded, so the same seed gives the same weeks.
 *
 * Restock never tops stock up freely: `scarcityTarget` is the share of in-play products whose restock is sized to
 * sit near or below the kitchens' need, so there is something to match and contend for.
 *
 * Pure: no Svelte, no DOM, no I/O, no wall clock.
 */
import { addDays } from '../scenario';

/** Every regular assumption in one place, with where it comes from (the Forecast's "why this level"). */
export const ESTIMATES = {
	weekday: {
		source: 'team estimate',
		note: 'Draw by weekday (Mon=0), relative to the weekly mean, per kitchen type.',
		byKind: {
			lunch_restaurant: [1.35, 1.3, 1.3, 1.3, 1.25, 0.3, 0.2],
			public_central_kitchen: [1.3, 1.3, 1.3, 1.3, 1.2, 0.35, 0.25],
			care_home_kitchen: [1, 1, 1, 1, 1, 1, 1],
			city_hotel: [0.85, 0.85, 0.9, 0.95, 1.15, 1.35, 0.95],
			ski_resort_hotel: [0.8, 0.8, 0.85, 0.95, 1.2, 1.4, 1],
			a_la_carte_restaurant: [0.6, 0.85, 0.95, 1.05, 1.3, 1.4, 0.85],
			cafe: [0.95, 0.95, 0.95, 1, 1.05, 1.15, 0.95]
		} as Record<string, number[]>,
		fallback: [1, 1, 1, 1, 1.05, 1, 0.95]
	},
	festive: {
		source: 'team estimate',
		note: 'Christmas: demand rises in the 10 days before 24 Dec, peaks on the 22nd–23rd.',
		from: '12-14',
		peak: '12-22',
		to: '12-23',
		factor: 1.45
	},
	cover: {
		source: 'team estimate',
		note: "Valio's answer covers this many days of everyone's demand (wholesale stock turn).",
		stockDays: 6,
		terminalDays: 10
	},
	restock: {
		source: 'team estimate',
		note: 'Warehouse (Stock) items restock on these weekdays; supplier (Terminal) items every cycle after lead time.',
		stockWeekdays: [0, 3],
		terminalCycleDays: 7
	},
	reliability: {
		source: 'Valio reliability file',
		note: 'A product with reliability 0.87 arrives short on about 13% of restocks; unknown reliability uses the default.',
		defaultShortShip: 0.08,
		shortShare: [0.3, 0.8]
	},
	noise: {
		source: 'team estimate',
		note: 'Day-to-day demand varies a few percent around the curve.',
		pct: 0.06
	}
} as const;

/** The knobs the Valio twin will expose later (D27 addendum). */
export interface StockParams {
	seed: string;
	/** First modelled day (YYYY-MM-DD); day 0 is Valio's answer. */
	from: string;
	days: number;
	/** Multiplies everyone's background demand (1 = the estimate). */
	demandLevel: number;
	/** Share of in-play products whose restock is sized near or below the kitchens' need (0–1). */
	scarcityTarget: number;
	/** Overrides the warehouse restock weekdays and supplier cycle. */
	restockWeekdays?: number[];
	terminalCycleDays?: number;
	/** Overrides the short-ship rate for products with no reliability figure. */
	shortShipRate?: number;
}

export const DEFAULT_PARAMS: Omit<StockParams, 'seed' | 'from'> = {
	days: 14,
	demandLevel: 1,
	scarcityTarget: 0.3
};

export interface StockProduct {
	productId: string;
	name: string;
	/** Sales units Valio said it has, or null when it gave no number (unknown or unlimited: not forecast). */
	start: number | null;
	/** The day Valio's answer is about. */
	asOf: string;
	logisticModel: 'Stock' | 'Terminal' | null;
	/** 0–1 from Valio's reliability file; absent = the default rate. */
	reliability?: number;
	unit: string;
}

/** Kitchens' use of a product on a day: committed orders drain stock; open plans are need, not yet drawn. */
export interface Draw {
	productId: string;
	day: string;
	qty: number;
	kitchenId: string;
	committed: boolean;
}

export type StockEvent =
	| { kind: 'shortage'; productId: string; day: string; left: number }
	| { kind: 'bump'; day: string; factor: number; note: string };

export type Why =
	'valio' | 'demand' | 'festive' | 'orders' | 'restock' | 'short-ship' | 'shortage' | 'scarce';

export interface DayLevel {
	day: string;
	/** Units at the end of the day (after draws and restock). */
	level: number;
	/** Kitchens' need on this day (committed + planned). */
	need: number;
	/** What moved the level today. Day 0 is Valio's answer. */
	why: Why[];
	source: 'valio' | 'model';
}

export interface ProductForecast {
	productId: string;
	name: string;
	unit: string;
	days: DayLevel[];
	/** First day the level falls below that day's kitchen need, or to zero; null if never in the window. */
	shortOn: string | null;
	/** Sized near the kitchens' need by scarcityTarget. */
	scarce: boolean;
	minLevel: number;
}

/** A small seeded PRNG (mulberry32) over a string seed. */
export function rng(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Weekday of a date, Monday = 0. */
export function weekday(day: string): number {
	return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** The festive factor on a day (1 outside the window), ramping up to the peak. */
export function festiveFactor(day: string): number {
	const f = ESTIMATES.festive;
	const md = day.slice(5);
	if (md < f.from || md > f.to) return 1;
	if (md >= f.peak) return f.factor;
	const span = Number(f.peak.slice(3)) - Number(f.from.slice(3));
	const into = Number(md.slice(3)) - Number(f.from.slice(3));
	return 1 + ((f.factor - 1) * into) / Math.max(1, span);
}

/** The weekday curve of a kitchen mix: the average of each kitchen type's curve (equal weight). */
export function mixCurve(kinds: readonly string[]): number[] {
	const curves = kinds.length
		? kinds.map((k) => ESTIMATES.weekday.byKind[k] ?? ESTIMATES.weekday.fallback)
		: [ESTIMATES.weekday.fallback];
	return [0, 1, 2, 3, 4, 5, 6].map((d) => curves.reduce((n, c) => n + c[d], 0) / curves.length);
}

/** Whether a product sits in the scarce share: a seeded draw per product, so the share holds across runs. */
export function isScarce(seed: string, productId: string, target: number): boolean {
	return rng(`${seed}|scarce|${productId}`)() < target;
}

/**
 * Forecast every product with a number from Valio over `params.days` days from `params.from`.
 * `kinds` is the workspace's kitchen types (the demand curve); `draws` the kitchens' orders and plans.
 */
export function forecast(
	products: readonly StockProduct[],
	draws: readonly Draw[],
	kinds: readonly string[],
	params: StockParams,
	events: readonly StockEvent[] = []
): ProductForecast[] {
	const curve = mixCurve(kinds);
	const restockDays: readonly number[] = params.restockWeekdays ?? ESTIMATES.restock.stockWeekdays;
	const cycle = params.terminalCycleDays ?? ESTIMATES.restock.terminalCycleDays;
	const byProduct = new Map<string, Draw[]>();
	for (const d of draws) {
		const list = byProduct.get(d.productId);
		if (list) list.push(d);
		else byProduct.set(d.productId, [d]);
	}
	const bumps = events.filter((e): e is Extract<StockEvent, { kind: 'bump' }> => e.kind === 'bump');
	const out: ProductForecast[] = [];
	for (const p of products) {
		if (p.start == null || !Number.isFinite(p.start)) continue;
		const mine = byProduct.get(p.productId) ?? [];
		const needOn = new Map<string, number>();
		const drawnOn = new Map<string, number>();
		for (const d of mine) {
			needOn.set(d.day, (needOn.get(d.day) ?? 0) + d.qty);
			if (d.committed) drawnOn.set(d.day, (drawnOn.get(d.day) ?? 0) + d.qty);
		}
		const windowNeed = [...needOn.entries()]
			.filter(([day]) => day >= params.from && day < addDays(params.from, params.days))
			.reduce((n, [, q]) => n + q, 0);
		const scarce = windowNeed > 0 && isScarce(params.seed, p.productId, params.scarcityTarget);
		const terminal = p.logisticModel === 'Terminal';
		const coverDays = terminal ? ESTIMATES.cover.terminalDays : ESTIMATES.cover.stockDays;
		// Everyone else's mean daily draw, implied by Valio's answer covering coverDays of it.
		const baseDraw = (p.start / coverDays) * params.demandLevel;
		// What a restock brings the level up to: the answer's own level, or (scarce) about the kitchens' need.
		const topUp = scarce ? Math.max(1, windowNeed * 0.9) : p.start;
		const shortRate =
			p.reliability != null
				? 1 - p.reliability
				: (params.shortShipRate ?? ESTIMATES.reliability.defaultShortShip);
		const r = rng(`${params.seed}|${p.productId}`);
		const [shortMin, shortMax] = ESTIMATES.reliability.shortShare;

		let level = scarce ? Math.min(p.start, topUp) : p.start;
		const days: DayLevel[] = [
			{
				day: params.from,
				level: round(level),
				need: needOn.get(params.from) ?? 0,
				why: scarce ? ['valio', 'scarce'] : ['valio'],
				source: 'valio'
			}
		];
		let shortOn: string | null = null;
		if ((needOn.get(params.from) ?? 0) > level) shortOn = params.from;
		let sinceRestock = 0;
		for (let i = 1; i < params.days; i++) {
			const day = addDays(params.from, i);
			const why: Why[] = [];
			const fest = festiveFactor(day);
			const bump = bumps.filter((b) => b.day === day).reduce((n, b) => n * b.factor, 1);
			const noise = 1 + (r() * 2 - 1) * ESTIMATES.noise.pct;
			const background = baseDraw * curve[weekday(day)] * fest * bump * noise;
			level -= background;
			why.push(fest > 1 || bump !== 1 ? 'festive' : 'demand');
			// What the kitchens find on hand today, before their own orders are picked.
			const onHand = Math.max(0, level);
			const ordered = drawnOn.get(day) ?? 0;
			if (ordered) {
				level -= ordered;
				why.push('orders');
			}
			sinceRestock += 1;
			const restockToday = terminal ? sinceRestock >= cycle : restockDays.includes(weekday(day));
			if (restockToday && level < topUp) {
				sinceRestock = 0;
				let arriving = topUp - Math.max(0, level);
				if (r() < shortRate) {
					arriving *= shortMin + r() * (shortMax - shortMin);
					why.push('short-ship');
				} else why.push('restock');
				level = Math.max(0, level) + arriving;
			}
			for (const e of events)
				if (e.kind === 'shortage' && e.productId === p.productId && e.day === day) {
					level = Math.min(level, e.left);
					why.push('shortage');
				}
			level = Math.max(0, level);
			const need = needOn.get(day) ?? 0;
			if (!shortOn && (level <= 0 || need > onHand)) shortOn = day;
			days.push({ day, level: round(level), need, why, source: 'model' });
		}
		out.push({
			productId: p.productId,
			name: p.name,
			unit: p.unit,
			days,
			shortOn,
			scarce,
			minLevel: Math.min(...days.map((d) => d.level))
		});
	}
	return out.sort(
		(a, b) =>
			(a.shortOn ?? '9999').localeCompare(b.shortOn ?? '9999') ||
			a.minLevel - b.minLevel ||
			a.productId.localeCompare(b.productId)
	);
}

const round = (n: number) => Math.round(n * 10) / 10;
